
import React from 'react';

export const COLORS = {
  primary: '#4a5d45', // The dark olive green from logo
  background: '#fdfdfb',
  text: '#2c3327',
  accent: '#a7b8a1',
};

export const Logo = ({ className = "" }: { className?: string }) => (
  <div className={`flex items-center gap-1 select-none cursor-pointer ${className}`}>
    <span className="serif italic text-[38px] font-normal tracking-tight text-[#4a5d45] leading-none">
      prep(x)
    </span>
  </div>
);
