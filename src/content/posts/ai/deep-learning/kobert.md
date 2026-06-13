---
title: 'KoBERT: 한국어 BERT 모델 소개와 파인튜닝 예제'
description: KoBERT는 한국어 위키 5백만 문장으로 사전학습된 BERT 모델이다. 한국어 텍스트 분류, 감성 분석 등에 파인튜닝하는
  방법과 BERTDataset, BERTClassifier 구현 코드를 정리한다.
pubDatetime: 2025-07-04
tags:
- AI
- 딥러닝
- KoBERT
- BERT
- 한국어 NLP
---


KoBERT는 BERT 모델에서 한국어 데이터를 추가로 학습시킨 모델로, 한국어 위키에서 5백만개의 문장과 54백만개의 단어를 학습시킨 모델이다. 따라서 한국어 데이터에 대해서도 높은 정확도를 낼 수 있다고 한다.

이러한 BERT의 큰 특징은 방대한 양의 데이터(약 33억개 단어)로 먼저 학습(pretrain)되었다는 것과, 자신의 사용 목적에 따라 파인튜닝(finetuning)이 가능하다는 점이다. 따라서 output layer만 추가로 달아주면 원하는 결과를 출력해내는 기계번역 모델을 만들어 낼 수 있다.

```python
class BERTDataset(Dataset):
    def __init__(self, dataset, sent_idx, label_idx, bert_tokenizer, max_len,
                 pad, pair):
        transform = nlp.data.BERTSentenceTransform(
            bert_tokenizer, max_seq_length=max_len, pad=pad, pair=pair)

        self.sentences = [transform([i[sent_idx]]) for i in dataset]
        self.labels = [np.int32(i[label_idx]) for i in dataset]

    def __getitem__(self, i):
        return (self.sentences[i] + (self.labels[i], ))

    def __len__(self):
        return (len(self.labels))
```

하이퍼 파라미터들을 조정해준다.

```python
# Setting parameters
max_len = 64
batch_size = 64
warmup_ratio = 0.1
num_epochs = 5
max_grad_norm = 1
log_interval = 200
learning_rate =  5e-5
```

이제 버트토크나이저와 위에서 정의한 클래스를 적용해 토큰화와 패딩을 해준다.

```python
#토큰화
tokenizer = get_tokenizer()
tok = nlp.data.BERTSPTokenizer(tokenizer, vocab, lower=False)

data_train = BERTDataset(dataset_train, 0, 1, tok, max_len, True, False)
data_test = BERTDataset(dataset_test, 0, 1, tok, max_len, True, False)
```

> print(data_train[0]) 실행

```python
(array([   2, 1189,  517, 6188, 7245, 7063,  517,  463, 3486, 7836, 5966,
        1698,  517, 6188, 7245, 7063,  517,  463, 1281, 7870, 1801, 6885,
        7088, 5966, 1698, 5837, 5837,  517, 6188, 7245, 6398, 6037, 7063,
         517,  463,  517,  463,  517,  364,  517,  364,    3,    1,    1,
           1,    1,    1,    1,    1,    1,    1,    1,    1,    1,    1,
           1,    1,    1,    1,    1,    1,    1,    1,    1], dtype=int32),
 array(42, dtype=int32),
 
 array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
       dtype=int32), 5)
```

출력값들을 보면 3개의 array가 출력되는데, 
첫 번째는 **패딩된 시퀀스**, 
두 번째는 **길이와 타입에 대한 내용**, 
세 번재는 **어텐션 마스크 시퀀스**이다.

어텐션 마스크는 BERT에 데이터가 입력되었을 때 어텐션 함수가 적용되어 연산이 된다.
이때 1로 패딩된 값들은 연산할 필요가 없기 때문에 연산을 하지 않아도 된다고 알려주는 데이터가 있어야 하는데 그게 바로 어텐션 마스크 시퀀스인 것이다.
이렇게 BERT나 KoBERT에는 어텐션 마스크 데이터도 함께 입력되어야 한다

torch 형식의 dataset을 만들어준다.

```python
train_dataloader = torch.utils.data.DataLoader(data_train, batch_size=batch_size, num_workers=5)
test_dataloader = torch.utils.data.DataLoader(data_test, batch_size=batch_size, num_workers=5)
```

### KoBERT 학습모델 만들기
학습시킬 KoBERT 모델을 만들어야 하는데, 아래 코드에서 다중분류할 클래스 수 만큼 num_classes 변수를 수정해주어야 한다. 이번 프로젝트에서는 7가지의 class를 분류하기 때문에 7로 입력해주었다.

```python
class BERTClassifier(nn.Module):
    def __init__(self,
                 bert,
                 hidden_size = 768,
                 num_classes=7,   ##클래스 수 조정##
                 dr_rate=None,
                 params=None):
        super(BERTClassifier, self).__init__()
        self.bert = bert
        self.dr_rate = dr_rate
                 
        self.classifier = nn.Linear(hidden_size , num_classes)
        if dr_rate:
            self.dropout = nn.Dropout(p=dr_rate)
    
    def gen_attention_mask(self, token_ids, valid_length):
        attention_mask = torch.zeros_like(token_ids)
        for i, v in enumerate(valid_length):
            attention_mask[i][:v] = 1
        return attention_mask.float()

    def forward(self, token_ids, valid_length, segment_ids):
        attention_mask = self.gen_attention_mask(token_ids, valid_length)
        
        _, pooler = self.bert(input_ids = token_ids, token_type_ids = segment_ids.long(), attention_mask = attention_mask.float().to(token_ids.device))
        if self.dr_rate:
            out = self.dropout(pooler)
        return self.classifier(out)
```

```python
#BERT 모델 불러오기
model = BERTClassifier(bertmodel,  dr_rate=0.5).to(device)

#optimizer와 schedule 설정
no_decay = ['bias', 'LayerNorm.weight']
optimizer_grouped_parameters = [
    {'params': [p for n, p in model.named_parameters() if not any(nd in n for nd in no_decay)], 'weight_decay': 0.01},
    {'params': [p for n, p in model.named_parameters() if any(nd in n for nd in no_decay)], 'weight_decay': 0.0}
]

optimizer = AdamW(optimizer_grouped_parameters, lr=learning_rate)
loss_fn = nn.CrossEntropyLoss()

t_total = len(train_dataloader) * num_epochs
warmup_step = int(t_total * warmup_ratio)

scheduler = get_cosine_schedule_with_warmup(optimizer, num_warmup_steps=warmup_step, num_training_steps=t_total)

#정확도 측정을 위한 함수 정의
def calc_accuracy(X,Y):
    max_vals, max_indices = torch.max(X, 1)
    train_acc = (max_indices == Y).sum().data.cpu().numpy()/max_indices.size()[0]
    return train_acc
    
train_dataloader
```

### 6.KoBERT 모델 학습시키기

학습 데이터셋과 학습 모델 준비가 다 끝났다면 이제 아래 코드 실행을 통해 KoBERT 모델을 학습시켜준다.

```python
for e in range(num_epochs):
    train_acc = 0.0
    test_acc = 0.0
    model.train()
    for batch_id, (token_ids, valid_length, segment_ids, label) in enumerate(tqdm_notebook(train_dataloader)):
        optimizer.zero_grad()
        token_ids = token_ids.long().to(device)
        segment_ids = segment_ids.long().to(device)
        valid_length= valid_length
        label = label.long().to(device)
        out = model(token_ids, valid_length, segment_ids)
        loss = loss_fn(out, label)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), max_grad_norm)
        optimizer.step()
        scheduler.step()  # Update learning rate schedule
        train_acc += calc_accuracy(out, label)
        if batch_id % log_interval == 0:
            print("epoch {} batch id {} loss {} train acc {}".format(e+1, batch_id+1, loss.data.cpu().numpy(), train_acc / (batch_id+1)))
    print("epoch {} train acc {}".format(e+1, train_acc / (batch_id+1)))
    
    model.eval()
    for batch_id, (token_ids, valid_length, segment_ids, label) in enumerate(tqdm_notebook(test_dataloader)):
        token_ids = token_ids.long().to(device)
        segment_ids = segment_ids.long().to(device)
        valid_length= valid_length
        label = label.long().to(device)
        out = model(token_ids, valid_length, segment_ids)
        test_acc += calc_accuracy(out, label)
    print("epoch {} test acc {}".format(e+1, test_acc / (batch_id+1)))
```

