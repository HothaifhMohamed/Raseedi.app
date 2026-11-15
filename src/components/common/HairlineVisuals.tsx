import React from 'react';
import {
  Basket,
  Drawer,
  Padlock,
  Plot,
  Riffle,
  Stack,
  Terrain,
  Vault,
  type HairlineProps,
} from '@lucasmarkes/hairline/react';

export type HairlineFigureName =
  | 'vault'
  | 'padlock'
  | 'plot'
  | 'terrain'
  | 'drawer'
  | 'basket'
  | 'stack'
  | 'riffle';

export type HairlineSurfaceVariant = 'surface' | 'bg' | 'wallet';
export type HairlineTone = 'accent' | 'muted' | 'wallet';

interface HairlineFigureProps {
  figure: HairlineFigureName;
  surface?: HairlineSurfaceVariant;
  plateColor?: string;
  tone?: HairlineTone;
  intensity?: number;
  play?: boolean;
  stroke?: number;
  label?: string;
  className?: string;
}

const FIGURE_COMPONENTS: Record<HairlineFigureName, React.ComponentType<HairlineProps>> = {
  vault: Vault,
  padlock: Padlock,
  plot: Plot,
  terrain: Terrain,
  drawer: Drawer,
  basket: Basket,
  stack: Stack,
  riffle: Riffle,
};

/**
 * Renders a themed @lucasmarkes/hairline isometric line figure whose `--hairline-plate`
 * matches its host container so isometric planes never clash with cream, dark-stone,
 * or custom colored wallet cards.
 */
export const HairlineFigure: React.FC<HairlineFigureProps> = ({
  figure,
  surface = 'surface',
  plateColor,
  tone = surface === 'wallet' ? 'wallet' : 'accent',
  intensity = 0.72,
  play = false,
  stroke = 1.05,
  label,
  className = '',
}) => {
  const Figure = FIGURE_COMPONENTS[figure];

  const resolvedPlate =
    surface === 'wallet'
      ? plateColor || '#3A605B'
      : surface === 'bg'
      ? 'var(--color-bg)'
      : 'var(--color-surface)';

  const styleVars: Record<string, string | number> =
    tone === 'wallet'
      ? {
          '--hairline-plate': resolvedPlate,
          '--hairline-hi': '#FFFFFF',
          '--hairline-edge': 'rgba(255, 255, 255, 0.88)',
          '--hairline-mid': 'rgba(255, 255, 255, 0.52)',
          '--hairline-lo': 'rgba(255, 255, 255, 0.24)',
          '--hairline-stroke': stroke,
        }
      : tone === 'muted'
      ? {
          '--hairline-plate': resolvedPlate,
          '--hairline-hi': 'var(--color-accent)',
          '--hairline-edge': 'var(--color-muted)',
          '--hairline-mid': 'var(--color-line)',
          '--hairline-lo': 'var(--color-line)',
          '--hairline-stroke': stroke,
        }
      : {
          '--hairline-plate': resolvedPlate,
          '--hairline-hi': 'var(--color-accent)',
          '--hairline-edge': 'var(--color-ink)',
          '--hairline-mid': 'var(--color-muted)',
          '--hairline-lo': 'var(--color-line)',
          '--hairline-stroke': stroke,
        };

  return (
    <div
      dir="ltr"
      className={`select-none touch-none ${className}`}
      style={styleVars as React.CSSProperties}
    >
      <Figure
        theme={surface === 'wallet' ? 'dark' : 'auto'}
        intensity={intensity}
        play={play}
        label={label}
        className="w-full"
      />
    </div>
  );
};

interface HairlineEmptyStateProps {
  figure: 'drawer' | 'plot' | 'vault' | 'basket';
  title: string;
  description?: string;
  surface?: 'surface' | 'bg';
  action?: React.ReactNode;
  className?: string;
  figureClassName?: string;
  label?: string;
}

/**
 * Reusable interactive empty state featuring a muted isometric Hairline illustration
 * that responds gently to mouse/touch movement.
 */
export const HairlineEmptyState: React.FC<HairlineEmptyStateProps> = ({
  figure,
  title,
  description,
  surface = 'surface',
  action,
  className = '',
  figureClassName = 'w-28 sm:w-32',
  label,
}) => {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center py-7 px-4 ${className}`}
    >
      <div className={`${figureClassName} mb-3 transition-transform duration-300 hover:scale-105`}>
        <HairlineFigure
          figure={figure}
          surface={surface}
          tone="muted"
          intensity={0.78}
          play={true}
          stroke={0.95}
          label={label || title}
        />
      </div>
      <h3 className="text-sm font-bold text-[var(--color-ink)] mb-1">{title}</h3>
      {description && (
        <p className="text-xs text-[var(--color-muted)] max-w-xs leading-relaxed mb-3">
          {description}
        </p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
};
