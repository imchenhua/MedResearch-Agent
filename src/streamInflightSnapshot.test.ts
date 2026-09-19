import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createEmptyLiveAgentBlocks } from './liveAgentBlocks';
import { streamingStore } from './streamingStore';
import {
	ensureDraftHasLiveBlocks,
	snapshotInflightStoreIntoDraft,
	type OffThreadStreamDraft,
} from './streamInflightSnapshot';

describe('snapshotInflightStoreIntoDraft', () => {
	beforeEach(() => {
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			queueMicrotask(() => cb(0));
			return 0;
		});
		vi.stubGlobal('cancelAnimationFrame', () => {});
		streamingStore.flush();
		streamingStore.setStreaming('');
		streamingStore.setStreamingThinking('');
		streamingStore.resetLiveBlocks();
	});

	afterEach(() => {
		streamingStore.flush();
		streamingStore.setStreaming('');
		streamingStore.setStreamingThinking('');
		streamingStore.resetLiveBlocks();
		vi.unstubAllGlobals();
	});

	it('在离开仍有后台流的线程时把 streamingStore 快照写入草稿', () => {
		streamingStore.setStreaming('hello');
		streamingStore.setStreamingThinking('t');
		const draftsRef = {
			current: {} as Record<string, OffThreadStreamDraft>,
		};
		snapshotInflightStoreIntoDraft({
			leavingThreadId: 'thread-a',
			selectedThreadId: 'thread-b',
			ipcInflightThreadId: 'thread-a',
			draftsRef,
		});
		expect(draftsRef.current['thread-a']?.streaming).toBe('hello');
		expect(draftsRef.current['thread-a']?.streamingThinking).toBe('t');
		expect(draftsRef.current['thread-a']?.liveAssistantBlocks.blocks).toEqual([]);
	});

	it('若 IPC 活动线程与离开的线程不一致则不快照', () => {
		streamingStore.setStreaming('x');
		const draftsRef = { current: {} as Record<string, OffThreadStreamDraft> };
		snapshotInflightStoreIntoDraft({
			leavingThreadId: 'thread-a',
			selectedThreadId: 'thread-b',
			ipcInflightThreadId: 'thread-c',
			draftsRef,
		});
		expect(Object.keys(draftsRef.current).length).toBe(0);
	});
});

describe('ensureDraftHasLiveBlocks', () => {
	it('为仅有字符串的旧草稿补上 liveAssistantBlocks', () => {
		const row = { streaming: 'a', streamingThinking: 'b' };
		const out = ensureDraftHasLiveBlocks(row);
		expect(out.liveAssistantBlocks).toEqual(createEmptyLiveAgentBlocks());
	});
});
