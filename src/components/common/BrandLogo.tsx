import React, { useId } from 'react';

interface BrandLogoProps {
  className?: string;
  title?: string;
}

/**
 * Official Raseedi Brand Emblem matching /public/icon.svg and /public/apple-touch-icon.png
 * (deep teal backdrop, cream wallet, gold coin, upward growth arrow).
 */
export const BrandLogo: React.FC<BrandLogoProps> = ({
  className = 'w-8 h-8',
  title = 'رَصِيدِي',
}) => {
  const uid = useId().replace(/:/g, '');
  const bgId = `raseediBg-${uid}`;
  const coinId = `coinGold-${uid}`;
  const slotClipId = `coinSlotClip-${uid}`;
  const maskId = `walletCutouts-${uid}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      className={`overflow-hidden ${className}`}
      role="img"
      aria-label={title}
    >
      <defs>
        <linearGradient id={bgId} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#07383E" />
          <stop offset="48%" stopColor="#0A5455" />
          <stop offset="100%" stopColor="#0C7C6D" />
        </linearGradient>
        <linearGradient id={coinId} x1="20%" y1="10%" x2="85%" y2="90%">
          <stop offset="0%" stopColor="#E4A731" />
          <stop offset="100%" stopColor="#D79825" />
        </linearGradient>
        <clipPath id={slotClipId}>
          <rect x="0" y="0" width="512" height="168" />
        </clipPath>
        <mask id={maskId}>
          <rect width="512" height="512" fill="#FFFFFF" />
          <rect x="96" y="156" width="272" height="30" rx="15" fill="#000000" />
          <rect x="150" y="118" width="202" height="56" fill="#000000" />
          <path
            d="M 432 248 L 382 248 A 56 56 0 0 0 382 360 L 432 360 Z"
            fill="#000000"
          />
          <path
            d="M 52 440 L 154 334 L 200 374 L 266 304 L 288 324 L 202 414 L 154 374 L 74 458 Z"
            fill="#000000"
          />
          <polygon points="214,284 318,256 298,358" fill="#000000" />
        </mask>
      </defs>

      <rect width="512" height="512" fill={`url(#${bgId})`} />

      <g clipPath={`url(#${slotClipId})`}>
        <circle cx="251" cy="132" r="84" fill={`url(#${coinId})`} />
        <circle cx="251" cy="132" r="66" fill="none" stroke="#C5861D" strokeWidth="10" opacity="0.45" />
        <path
          d="M 192 168 A 66 66 0 0 1 304 98 A 59 59 0 0 0 206 168 Z"
          fill="#F3CD77"
          opacity="0.92"
        />
      </g>

      <g mask={`url(#${maskId})`}>
        <path
          d="M 98 128 L 364 128 Q 392 128 392 156 L 392 186 L 398 186 Q 432 186 432 222 L 432 426 Q 432 462 396 462 L 100 462 Q 64 462 64 426 L 64 162 Q 64 128 98 128 Z"
          fill="#FAF0DD"
        />
      </g>

      <path
        d="M 382 264 L 440 264 Q 454 264 454 278 L 454 330 Q 454 344 440 344 L 382 344 A 40 40 0 0 1 382 264 Z"
        fill="#FAF0DD"
      />
    </svg>
  );
};
