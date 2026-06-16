#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { D2 } from "@terrastruct/d2";

function fail(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const code = String(input.code ?? "");
  const options = input.options ?? {};
  const salt = String(input.salt ?? "");

  const d2 = new D2();
  const result = await d2.compile(code, {
    layout: options.layout,
    sketch: options.sketch,
    themeID: options.themeID,
    darkThemeID: options.darkThemeID,
    center: options.center,
    pad: options.pad,
    scale: options.scale,
    salt,
    noXMLTag: true,
  });
  const svg = await d2.render(result.diagram, {
    ...result.renderOptions,
    themeID: options.themeID,
    darkThemeID: options.darkThemeID,
    center: options.center,
    pad: options.pad,
    scale: options.scale,
    salt,
    noXMLTag: true,
  });

  process.stdout.write(JSON.stringify({ svg }));
  process.exit(0);
} catch (error) {
  fail(error);
}
