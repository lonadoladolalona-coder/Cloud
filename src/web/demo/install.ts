import type { JobRecord } from '../../shared/api';
import { createDemo } from './backend';

/** Imported first by the demo entry: swaps the network layer for the in-page simulation before the app loads. */
const demo = createDemo();
(globalThis as { __H3_DEMO__?: unknown }).__H3_DEMO__ = demo.api;

type Handler = (e: MessageEvent<string>) => void;

class DemoEventSource {
  private handlers = new Map<string, Set<Handler>>();
  private off: () => void;
  constructor(_url: string) {
    this.off = demo.onJob((job: JobRecord) => this.fire('job', JSON.stringify(job)));
    queueMicrotask(() => this.fire('ready', '1'));
  }
  addEventListener(type: string, fn: Handler): void {
    (this.handlers.get(type) ?? this.handlers.set(type, new Set()).get(type)!).add(fn);
  }
  removeEventListener(type: string, fn: Handler): void {
    this.handlers.get(type)?.delete(fn);
  }
  close(): void {
    this.off();
  }
  private fire(type: string, data: string): void {
    for (const fn of this.handlers.get(type) ?? []) fn(new MessageEvent(type, { data }));
  }
}
(globalThis as { EventSource: unknown }).EventSource = DemoEventSource;

// <img>/<video>/<a> point at /files/... on the real server; here those files are data: URLs held in memory.
// React sets some of these through the DOM property (img.src) and some through setAttribute, so cover both.
const mapped = (value: unknown): unknown => (typeof value === 'string' && value.startsWith('/files/') ? demo.resolveFile(value) ?? value : value);

const setAttribute = Element.prototype.setAttribute;
Element.prototype.setAttribute = function (name: string, value: string) {
  return setAttribute.call(this, name, (name === 'src' || name === 'href' || name === 'poster' ? mapped(value) : value) as string);
};

for (const [proto, prop] of [[HTMLImageElement.prototype, 'src'], [HTMLMediaElement.prototype, 'src'], [HTMLVideoElement.prototype, 'poster'], [HTMLAnchorElement.prototype, 'href']] as const) {
  const desc = Object.getOwnPropertyDescriptor(proto, prop);
  if (!desc?.set) continue;
  Object.defineProperty(proto, prop, { ...desc, set(this: unknown, value: unknown) { desc.set!.call(this, mapped(value)); } });
}
