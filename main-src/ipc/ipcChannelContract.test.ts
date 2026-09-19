import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * IPC channel contract test.
 *
 * Why this file exists: the renderer can only reach the main process through
 * `window.medresearchShell.invoke()`, which rejects any channel that is not
 * listed in `INVOKE_CHANNELS` inside `electron/preload.cjs`. That whitelist and
 * the `ipcMain.handle('...')` registrations live in two different worlds
 * (preload.cjs vs. main-src/**) and nothing kept them in sync, so the same
 * class of drift shipped three times:
 *
 *   - `git:diffPreview` was registered in the main process but never whitelisted,
 *     so the renderer got `blocked IPC channel` and the handler was dead code.
 *   - `team:userInputRespond` and `terminal:ptyCreate/Write/Resize/Kill` stayed
 *     whitelisted long after their handlers were removed (`terminalPty.ts`).
 *
 * Both directions are now asserted here: every registered channel must be
 * reachable, and every whitelisted channel must actually exist.
 */

const MAIN_SRC_DIR = path.resolve(process.cwd(), 'main-src');
const PRELOAD_PATH = path.resolve(process.cwd(), 'electron', 'preload.cjs');

function collectSourceFiles(dir: string, out: string[] = []): string[] {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			collectSourceFiles(full, out);
		} else if (/\.(ts|mts|js|cjs)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
			// Test files are excluded: registerSmoke.test.ts registers a stub
			// channel to exercise the registration machinery.
			out.push(full);
		}
	}
	return out;
}

/** channel -> file that registers it (first registration wins). */
function collectRegisteredChannels(): Map<string, string> {
	const channels = new Map<string, string>();
	for (const file of collectSourceFiles(MAIN_SRC_DIR)) {
		const source = fs.readFileSync(file, 'utf8');
		const re = /ipcMain\.handle\(\s*['"]([^'"]+)['"]/g;
		let match: RegExpExecArray | null;
		while ((match = re.exec(source)) !== null) {
			const channel = match[1];
			if (!channels.has(channel)) {
				channels.set(channel, path.relative(process.cwd(), file));
			}
		}
	}
	return channels;
}

function collectPreloadWhitelist(): Set<string> {
	const preload = fs.readFileSync(PRELOAD_PATH, 'utf8');
	const block = preload.match(/INVOKE_CHANNELS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
	if (!block) {
		throw new Error(`Could not locate INVOKE_CHANNELS in ${PRELOAD_PATH}`);
	}
	return new Set(
		(block[1].match(/['"][^'"]+['"]/g) ?? []).map((literal) => literal.slice(1, -1))
	);
}

describe('IPC channel contract', () => {
	it(
		'every channel registered in the main process is whitelisted in preload',
		() => {
			const registered = collectRegisteredChannels();
			const whitelist = collectPreloadWhitelist();

			// Guard against the scanner silently matching nothing (e.g. if the
			// registration helper is renamed) — an empty set would make the
			// real assertions vacuously true.
			expect(registered.size).toBeGreaterThan(200);

			const unreachable = [...registered.entries()]
				.filter(([channel]) => !whitelist.has(channel))
				.map(([channel, file]) => `${channel}  (${file})`);

			expect(
				unreachable,
				`Registered but not whitelisted — the renderer will get ` +
					`"blocked IPC channel". Add them to INVOKE_CHANNELS in ` +
					`electron/preload.cjs, or delete the handler if it is dead:\n` +
					unreachable.join('\n')
			).toEqual([]);
		},
		15_000
	);

	it(
		'every whitelisted channel has a handler registered in the main process',
		() => {
			const registered = collectRegisteredChannels();
			const whitelist = collectPreloadWhitelist();

			expect(whitelist.size).toBeGreaterThan(200);

			const dangling = [...whitelist].filter((channel) => !registered.has(channel));

			expect(
				dangling,
				`Whitelisted but no ipcMain.handle() — dead entries, remove them ` +
					`from INVOKE_CHANNELS in electron/preload.cjs:\n` +
					dangling.join('\n')
			).toEqual([]);
		},
		15_000
	);
});
