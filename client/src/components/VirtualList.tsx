/**
 * Virtual Scrolling Component for High Performance Lists
 * Renders only visible items to handle thousands of entries without lag
 */

import { useState, useEffect, useRef, ReactNode } from 'react';

interface VirtualListProps<T> {
  items: T[];
  itemHeight: number;
  containerHeight: number;
  renderItem: (item: T, index: number) => ReactNode;
  overscan?: number; // Extra items to render outside viewport
  className?: string;
}

export function VirtualList<T>({
  items,
  itemHeight,
  containerHeight,
  renderItem,
  overscan = 5,
  className = ''
}: VirtualListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const scrollElementRef = useRef<HTMLDivElement>(null);

  const totalHeight = items.length * itemHeight;
  const viewportHeight = containerHeight;
  
  // Calculate visible range
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(
    items.length - 1,
    Math.ceil((scrollTop + viewportHeight) / itemHeight) + overscan
  );

  const visibleItems = items.slice(startIndex, endIndex + 1);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  return (
    <div
      ref={scrollElementRef}
      className={`overflow-auto ${className}`}
      style={{ height: containerHeight }}
      onScroll={handleScroll}
    >
      {/* Total container to maintain scroll height */}
      <div style={{ height: totalHeight, position: 'relative' }}>
        {/* Visible items container */}
        <div
          style={{
            transform: `translateY(${startIndex * itemHeight}px)`,
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
          }}
        >
          {visibleItems.map((item, index) => (
            <div
              key={startIndex + index}
              style={{ height: itemHeight }}
              className="flex-shrink-0"
            >
              {renderItem(item, startIndex + index)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Helper hook for dynamic item heights (advanced use case)
export function useVirtualList<T>(
  items: T[],
  estimatedItemHeight: number,
  containerHeight: number,
  getItemHeight?: (index: number) => number
) {
  const [heights, setHeights] = useState<number[]>([]);
  const [scrollTop, setScrollTop] = useState(0);

  const itemHeights = getItemHeight 
    ? items.map((_, index) => getItemHeight(index))
    : Array(items.length).fill(estimatedItemHeight);

  // Calculate cumulative heights for positioning
  const cumulativeHeights = itemHeights.reduce((acc, height, index) => {
    acc[index] = (acc[index - 1] || 0) + height;
    return acc;
  }, [] as number[]);

  const totalHeight = cumulativeHeights[cumulativeHeights.length - 1] || 0;

  // Find visible range with variable heights
  const findVisibleRange = () => {
    let startIndex = 0;
    let endIndex = items.length - 1;

    // Binary search for start index
    for (let i = 0; i < cumulativeHeights.length; i++) {
      if (cumulativeHeights[i] > scrollTop) {
        startIndex = Math.max(0, i - 1);
        break;
      }
    }

    // Find end index
    for (let i = startIndex; i < cumulativeHeights.length; i++) {
      if (cumulativeHeights[i] > scrollTop + containerHeight) {
        endIndex = i;
        break;
      }
    }

    return { startIndex, endIndex };
  };

  const { startIndex, endIndex } = findVisibleRange();
  const visibleItems = items.slice(startIndex, endIndex + 1);

  return {
    visibleItems,
    startIndex,
    endIndex,
    totalHeight,
    setScrollTop,
    getItemOffset: (index: number) => cumulativeHeights[index - 1] || 0,
  };
}