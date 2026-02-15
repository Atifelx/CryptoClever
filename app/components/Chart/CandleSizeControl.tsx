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
    <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-20 flex items-center gap-2 bg-[#1a1a1a]/60 backdrop-blur-sm border border-gray-700/60 rounded-lg px-3 py-1.5">
      <button
        onClick={handleDecrease}
        disabled={size <= minSize}
        className="w-7 h-7 flex items-center justify-center bg-[#2a2a2a]/80 hover:bg-[#3a3a3a]/80 disabled:opacity-40 disabled:cursor-not-allowed rounded text-white font-bold text-lg transition-colors"
        aria-label="Decrease candle size"
      >
        −
      </button>
      <span className="text-white text-xs font-semibold min-w-[2rem] text-center">
        {size}
      </span>
      <button
        onClick={handleIncrease}
        disabled={size >= maxSize}
        className="w-7 h-7 flex items-center justify-center bg-[#2a2a2a]/80 hover:bg-[#3a3a3a]/80 disabled:opacity-40 disabled:cursor-not-allowed rounded text-white font-bold text-lg transition-colors"
        aria-label="Increase candle size"
      >
        +
      </button>
    </div>
  );
}
