import React from 'react';

interface BrandLogoProps {
  className?: string;
  title?: string;
}

/**
 * Official Raseedi Brand Emblem rendered from /public/app-icon.png.
 */
export const BrandLogo: React.FC<BrandLogoProps> = ({
  className = 'w-10 h-10 rounded-xl object-cover shadow-sm',
  title = 'رَصِيدِي',
}) => {
  return (
    <img
      src="/app-icon.png"
      alt={title}
      title={title}
      className={`rounded-xl object-cover shadow-sm ${className}`}
    />
  );
};
