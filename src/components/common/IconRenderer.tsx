import React from 'react';
import * as LucideIcons from 'lucide-react';

interface IconRendererProps {
  name: string;
  className?: string;
  size?: number;
}

export const IconRenderer: React.FC<IconRendererProps> = ({ name, className = 'w-5 h-5', size = 20 }) => {
  const resolvedName = name === 'Safe' || name === 'PiggyBank' ? 'Vault' : name;
  // Look up icon dynamically in Lucide
  const IconComponent = (LucideIcons as unknown as Record<string, React.FC<LucideIcons.LucideProps>>)[resolvedName] || LucideIcons.Layers;

  return <IconComponent className={className} size={size} />;
};
