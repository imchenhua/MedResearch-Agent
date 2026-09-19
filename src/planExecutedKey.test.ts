import { describe, expect, it } from 'vitest';
import { planExecutedKey } from './planExecutedKey';

describe('planExecutedKey', () => {
	it('prefers relative path', () => {
		expect(planExecutedKey('/proj', '.medresearch/plans/a.plan.md', null)).toBe('.medresearch/plans/a.plan.md');
	});

	it('strips workspace root from absolute path', () => {
		expect(planExecutedKey('D:/proj', null, 'D:/proj/.medresearch/plans/x.plan.md')).toBe(
			'.medresearch/plans/x.plan.md'
		);
	});
});
