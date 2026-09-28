import { Slider as SliderPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/** つまみが 1 つのスライダー（shadcn の Slider を小さくしたもの）。aria-label はつまみに付ける */
function Slider({
  className,
  'aria-label': label,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        'relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted"
      >
        <SliderPrimitive.Range data-slot="slider-range" className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        aria-label={label}
        className="block size-3.5 shrink-0 rounded-full border border-primary bg-white shadow-sm transition-[color,box-shadow] outline-none hover:ring-4 hover:ring-ring/50 focus-visible:ring-4 focus-visible:ring-ring/50"
      />
    </SliderPrimitive.Root>
  );
}

export { Slider };
