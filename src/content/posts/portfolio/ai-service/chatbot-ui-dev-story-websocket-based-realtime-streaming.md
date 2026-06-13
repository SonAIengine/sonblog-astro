---
title: 챗봇 UI 개발기 - WebSocket 기반 실시간 스트리밍
description: WebSocket을 활용한 LLM 스트리밍 챗봇 UI 개발 과정. Next.js 프론트엔드와 FastAPI 백엔드 간 실시간
  토큰 스트리밍, 대화 히스토리 관리까지.
pubDatetime: 2024-08-01
tags:
- WebSocket
- 챗봇
- 프론트엔드
- 실시간
- Next.js
- FastAPI
- LLM
- 스트리밍
- React
- UI개발
- Portfolio
series: AI 서비스 개발
seriesOrder: 1
---

# 챗봇 UI 개발기 - WebSocket 기반 실시간 스트리밍

## 개요

2024년 3월, chatbot-ui-next 프로젝트에서 WebSocket 기반의 실시간 채팅 UI를 개발했다. 기존 HTTP 기반의 단순 요청/응답 구조에서 벗어나 실시간 스트리밍 응답 처리와 사용자 경험을 향상시키는 것이 주요 목표였다.


## 기술 스택

- **프론트엔드**: Next.js, React, TypeScript
- **WebSocket**: Socket.IO
- **UI 프레임워크**: Tailwind CSS
- **상태관리**: React Context API

## 주요 구현 내용

### 1. WebSocket 연결 관리

가장 먼저 해결해야 할 문제는 안정적인 WebSocket 연결 관리였다. 네트워크 불안정이나 서버 재시작 시 연결이 끊어지는 상황을 처리해야 했다.

```typescript
// socket-context.tsx
export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const newSocket = io(process.env.NEXT_PUBLIC_SOCKET_URL!, {
      transports: ['websocket'],
      timeout: 20000,
      forceNew: true
    });

    // 연결 이벤트 처리
    newSocket.on('connect', () => {
      setIsConnected(true);
      console.log('Socket connected:', newSocket.id);
    });

    // 재연결 로직
    newSocket.on('disconnect', () => {
      setIsConnected(false);
      console.log('Socket disconnected');
    });

    newSocket.on('reconnect', (attempt) => {
      console.log('Socket reconnected after', attempt, 'attempts');
      setIsConnected(true);
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
};
```

### 2. 스트리밍 응답 처리

AI 모델의 응답을 실시간으로 스트리밍하면서 사용자에게 보여주는 기능을 구현했다. 텍스트를 청크 단위로 받아서 기존 메시지에 계속 합쳐서 보여주는 방식을 채택했다.

```typescript
// chat-interface.tsx
const handleStreamMessage = useCallback((data: StreamMessage) => {
  setMessages(prev => {
    const newMessages = [...prev];
    const lastMessage = newMessages[newMessages.length - 1];
    
    if (lastMessage && lastMessage.isStreaming) {
      // 기존 스트리밍 메시지에 텍스트 합치기
      lastMessage.content += data.content;
      lastMessage.timestamp = new Date();
    } else {
      // 새로운 스트리밍 메시지 시작
      newMessages.push({
        id: data.messageId,
        content: data.content,
        isStreaming: true,
        sender: 'bot',
        timestamp: new Date()
      });
    }
    
    return newMessages;
  });
}, []);

useEffect(() => {
  if (!socket) return;

  socket.on('stream-message', handleStreamMessage);
  socket.on('stream-complete', (data) => {
    setMessages(prev => {
      const newMessages = [...prev];
      const targetMessage = newMessages.find(msg => msg.id === data.messageId);
      if (targetMessage) {
        targetMessage.isStreaming = false;
      }
      return newMessages;
    });
  });

  return () => {
    socket.off('stream-message', handleStreamMessage);
    socket.off('stream-complete');
  };
}, [socket, handleStreamMessage]);
```

### 3. 비동기 질문 처리

사용자가 이전 응답을 기다리지 않고 연속으로 질문을 보낼 수 있도록 비동기 방식을 적용했다. 각 질문에 고유 ID를 부여하고 큐 방식으로 처리했다.

```typescript
const sendMessage = async (content: string) => {
  if (!socket || !isConnected) {
    setError('연결이 끊어졌습니다. 새로고침해주세요.');
    return;
  }

  const messageId = uuidv4();
  const userMessage: Message = {
    id: messageId,
    content,
    sender: 'user',
    timestamp: new Date()
  };

  // 사용자 메시지 즉시 표시
  setMessages(prev => [...prev, userMessage]);

  // 서버에 비동기 요청
  socket.emit('send-message', {
    messageId,
    content,
    conversationId: currentConversationId
  });

  // 로딩 인디케이터 표시
  setIsLoading(prev => new Set([...prev, messageId]));
};
```

### 4. 반응형 UI 구현

데스크톱과 모바일 환경을 모두 고려한 반응형 디자인을 구현했다. 특히 채팅 입력창과 메시지 리스트의 레이아웃이 화면 크기에 따라 적절히 조정되도록 했다.

```css
/* 반응형 채팅 컨테이너 */
.chat-container {
  @apply flex flex-col h-screen max-w-4xl mx-auto;
}

.message-list {
  @apply flex-1 overflow-y-auto p-4 space-y-4;
  scrollbar-width: thin;
  scrollbar-color: rgb(156 163 175) transparent;
}

.input-container {
  @apply sticky bottom-0 bg-white border-t p-4;
}

/* 모바일 최적화 */
@media (max-width: 768px) {
  .chat-container {
    @apply h-screen;
  }
  
  .message-list {
    @apply p-2 space-y-2;
  }
  
  .input-container {
    @apply p-2;
  }
}
```

### 5. 테이블 데이터 렌더링

AI 응답에 포함된 표 형태의 데이터를 마크다운으로 파싱하여 HTML 테이블로 변환하는 기능을 구현했다.

```typescript
// table-renderer.tsx
const TableRenderer: React.FC<{ content: string }> = ({ content }) => {
  const renderTable = (tableMarkdown: string) => {
    const lines = tableMarkdown.trim().split('\n');
    const headers = lines[0].split('|').map(h => h.trim()).filter(h => h);
    const rows = lines.slice(2).map(row => 
      row.split('|').map(cell => cell.trim()).filter(cell => cell)
    );

    return (
      <div className="overflow-x-auto my-4">
        <table className="min-w-full border-collapse border border-gray-300">
          <thead>
            <tr className="bg-gray-50">
              {headers.map((header, index) => (
                <th key={index} className="border border-gray-300 px-4 py-2 text-left">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="border border-gray-300 px-4 py-2">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  // 마크다운 테이블 패턴 감지 및 변환
  const processedContent = content.replace(/\|.*\|[\s\S]*?\n(?=\n|$)/g, (match) => {
    return `<TABLE_PLACEHOLDER>${btoa(match)}</TABLE_PLACEHOLDER>`;
  });

  return <div dangerouslySetInnerHTML={{ __html: processedContent }} />;
};
```

## 트러블슈팅

### 1. 연결 끊김 문제

초기에는 네트워크가 불안정한 환경에서 WebSocket 연결이 자주 끊어지는 문제가 있었다. 이를 해결하기 위해 하트비트 기능과 자동 재연결 로직을 추가했다.

```typescript
// 하트비트 구현
useEffect(() => {
  if (!socket || !isConnected) return;

  const heartbeatInterval = setInterval(() => {
    socket.emit('ping');
  }, 30000); // 30초마다 ping

  socket.on('pong', () => {
    setLastHeartbeat(Date.now());
  });

  return () => {
    clearInterval(heartbeatInterval);
    socket.off('pong');
  };
}, [socket, isConnected]);
```

### 2. 메모리 누수 방지

스트리밍 메시지가 계속 쌓이면서 메모리 사용량이 늘어나는 문제가 있었다. 일정 개수 이상의 메시지는 자동으로 정리하는 로직을 추가했다.

```typescript
const MAX_MESSAGES = 1000;

const addMessage = useCallback((message: Message) => {
  setMessages(prev => {
    const newMessages = [...prev, message];
    if (newMessages.length > MAX_MESSAGES) {
      return newMessages.slice(-MAX_MESSAGES);
    }
    return newMessages;
  });
}, []);
```

## 성과 및 교훈

이 프로젝트를 통해 실시간 웹 애플리케이션 개발에 대한 깊은 이해를 얻을 수 있었다. WebSocket을 활용한 양방향 통신, 스트리밍 데이터 처리, 그리고 사용자 경험 최적화에 대한 실전 경험을 쌓았다.

특히 네트워크 불안정 상황에서의 복원력과 대용량 데이터 스트리밍 처리 능력을 개선할 수 있었으며, 이는 후속 프로젝트에서도 큰 도움이 되었다.

## 다음 단계

향후에는 다음과 같은 기능을 추가할 계획이다:

- 음성 입출력 지원
- 다국어 지원
- 채팅 히스토리 영구 저장
- 실시간 협업 기능