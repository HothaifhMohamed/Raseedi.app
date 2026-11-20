import React from 'react';
import {
  ArrowDownToLine,
  Banknote,
  BookOpen,
  Briefcase,
  Building2,
  Car,
  Coffee,
  Coins,
  CreditCard,
  DollarSign,
  Dumbbell,
  Fuel,
  Gift,
  GraduationCap,
  HandHeart,
  Heart,
  HeartPulse,
  Home,
  Landmark,
  Laptop,
  Layers,
  Music,
  Phone,
  Pill,
  Plane,
  Receipt,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Star,
  Tag,
  Target,
  TrendingUp,
  Trophy,
  Tv,
  Utensils,
  Vault,
  Wallet,
  Wifi,
  Wrench,
  Zap,
  type LucideProps,
} from 'lucide-react';

/**
 * Curated icon registry for categories, wallets, and goals.
 * Replaces `import * as LucideIcons from 'lucide-react'` so Rollup/Vite can
 * tree-shake ~1,400 unused icons (~500 KB saved from the initial JS bundle).
 */
const ICON_REGISTRY: Record<string, React.FC<LucideProps>> = {
  ArrowDownToLine,
  Banknote,
  BookOpen,
  Briefcase,
  Building2,
  Car,
  Coffee,
  Coins,
  CreditCard,
  DollarSign,
  Dumbbell,
  Fuel,
  Gift,
  GraduationCap,
  HandHeart,
  Heart,
  HeartPulse,
  Home,
  Landmark,
  Laptop,
  Layers,
  Music,
  Phone,
  Pill,
  Plane,
  Receipt,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Star,
  Tag,
  Target,
  TrendingUp,
  Trophy,
  Tv,
  Utensils,
  Vault,
  Wallet,
  Wifi,
  Wrench,
  Zap,
};

interface IconRendererProps {
  name: string;
  className?: string;
  size?: number;
}

export const IconRenderer: React.FC<IconRendererProps> = ({
  name,
  className = 'w-5 h-5',
  size = 20,
}) => {
  const resolvedName = name === 'Safe' || name === 'PiggyBank' ? 'Vault' : name;
  const IconComponent = ICON_REGISTRY[resolvedName] || Layers;

  return <IconComponent className={className} size={size} />;
};
