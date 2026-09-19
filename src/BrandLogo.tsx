import { useId } from 'react';

/**
 * MedResearch Agent 品牌标：字母 M 与医疗十字，蓝青渐变。
 */
export function BrandLogo({
	className,
	size = 22,
	'aria-label': ariaLabel,
}: {
	className?: string;
	size?: number;
	'aria-label'?: string;
}) {
	const gradientId = useId();

	return (
		<svg
			className={className}
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			role={ariaLabel ? 'img' : undefined}
			aria-hidden={ariaLabel ? undefined : true}
			aria-label={ariaLabel}
		>
			<defs>
				<linearGradient id={gradientId} x1="0" y1="24" x2="24" y2="0" gradientUnits="userSpaceOnUse">
					<stop offset="0" stopColor="#5B8CFF" />
					<stop offset="1" stopColor="#2FD3C4" />
				</linearGradient>
			</defs>
			<path
				d="M4 18V7l4 5.5L12 7v11"
				stroke={`url(#${gradientId})`}
				strokeWidth={2.2}
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path d="M16.5 12h5M19 9.5v5" stroke={`url(#${gradientId})`} strokeWidth={2} strokeLinecap="round" />
		</svg>
	);
}
