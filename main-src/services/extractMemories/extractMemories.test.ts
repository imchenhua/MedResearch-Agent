import { describe, expect, it } from 'vitest';
import { buildMemoryEntrypoint, renderMemoryFile } from './extractMemories.js';

describe('extractMemories helpers', () => {
	it('renders a memory file with frontmatter', () => {
		const out = renderMemoryFile({
			filename: 'project/api.md',
			name: 'API notes',
			description: 'Response envelope rules',
			type: 'project',
			content: 'Use `{ ok, data }`.',
		});
		expect(out).toContain('name: API notes');
		expect(out).toContain('description: Response envelope rules');
		expect(out).toContain('type: project');
		expect(out).toContain('Use `{ ok, data }`.');
	});

	it('builds MEMORY.md index lines from scanned headers', () => {
		const out = buildMemoryEntrypoint([
			{
				filename: 'project/api.md',
				filePath: '/tmp/project/api.md',
				mtimeMs: 1,
				title: 'API notes',
				description: 'Response envelope rules',
				type: 'project',
			},
			{
				filename: 'user/style.md',
				filePath: '/tmp/user/style.md',
				mtimeMs: 2,
				title: 'User style',
				description: 'Prefer concise answers',
				type: 'user',
			},
		]);
		expect(out).toContain('[API notes](project/api.md)');
		expect(out).toContain('[User style](user/style.md)');
	});
});
