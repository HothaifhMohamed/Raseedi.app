import React from 'react';

interface BrandLogoProps {
  className?: string;
  title?: string;
  lazy?: boolean;
}

/**
 * Official Raseedi Brand Emblem rendered from lightweight /icon-192.png (42KB vs 198KB 512px PNG).
 */
export const BrandLogo: React.FC<BrandLogoProps> = ({
  className = 'w-10 h-10 rounded-xl object-cover shadow-sm',
  title = 'رَصِيدِي',
  lazy = false,
}) => {
  return (
    <img
      src="/icon-192.png"
      alt={title}
      title={title}
      loading={lazy ? 'lazy' : 'eager'}
      decoding="async"
      className={`rounded-xl object-cover shadow-sm ${className}`}
    />
  );
};
