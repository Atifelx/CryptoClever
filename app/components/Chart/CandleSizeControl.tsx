'use client';

interface CandleSizeControlProps {
  size: number;
  onSizeChange: (size: number) => void;
}

export default function CandleSizeControl({ size, onSizeChange }: CandleSizeControlProps) {
  const minSize = 1;
  const maxSize = 10;

  const handleDecrease = () => {
    if (size > minSize) {
      onSizeChange(size - 1);
    }
  };

  const handleIncrease = () => {
    if (size < maxSize) {
      onSizeChange(size + 1);
    }
  };

  return (
    <div className="absolute bottom-3 right-3 z-20 flex items-center gap-0.5 bg-[#131722]/95 border border-[#2a2e39] rounded shadow-lg">
      <button
        onClick={handleDecrease}
        disabled={size <= minSize}
        className="w-7 h-7 flex items-center justify-center text-[#d1d4dc] hover:bg-[#2a2e39] disabled:opacity-40 disabled:cursor-not-allowed rounded-l text-sm font-medium transition-colors"
        aria-label="Zoom out"
      >
        −
      </button>
      <span className="w-8 h-7 flex items-center justify-center text-xs text-[#d1d4dc] border-x border-[#2a2e39] bg-[#1e222d]">
        {size}
      </span>
      <button
        onClick={handleIncrease}
        disabled={size >= maxSize}
        className="w-7 h-7 flex items-center justify-center text-[#d1d4dc] hover:bg-[#2a2e39] disabled:opacity-40 disabled:cursor-not-allowed rounded-r text-sm font-medium transition-colors"
        aria-label="Zoom in"
      >
        +
      </button>
    </div>
  );
}
