/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useMotionValue, useSpring } from 'motion/react';
import Lenis from 'lenis';

interface Task {
  id: string;
  text: string;
  completed: boolean;
  createdAt: number;
}

const STORAGE_KEY = 'brutalist_todo_tasks';
const LIME_ACCENT = '#84E425';

// Apple fluid spring configurations
const APPLE_SPRING = {
  type: 'spring' as const,
  stiffness: 400,
  damping: 30,
  mass: 0.8,
};

const APPLE_BOUNCE_SPRING = {
  type: 'spring' as const,
  stiffness: 450,
  damping: 24,
  mass: 0.6,
};

// Playful snappy spring for bouncy button feedback
const BOUNCY_BUTTON_SPRING = {
  type: 'spring' as const,
  stiffness: 500,
  damping: 15,
  mass: 0.5,
};

// Layout glide spring - perfectly critically damped to prevent any jitter
const LAYOUT_GLIDE_SPRING = {
  type: 'spring' as const,
  stiffness: 520,
  damping: 36,
  mass: 0.8,
};

// Slower, luxurious Apple easing curve for sweeps & draws
const APPLE_EASE = [0.16, 1, 0.3, 1] as const;

// Accurate point-to-rectangle Euclidean distance for consistent radial hit detection in all directions
function getDistanceToRect(px: number, py: number, rect: DOMRect) {
  const dx = Math.max(rect.left - px, 0, px - rect.right);
  const dy = Math.max(rect.top - py, 0, py - rect.bottom);
  return Math.hypot(dx, dy);
}

interface CustomMagneticCursorProps {
  snappedButtonId: string | null;
  setSnappedButtonId: React.Dispatch<React.SetStateAction<string | null>>;
  isSnappedClicking: boolean;
  setIsSnappedClicking: React.Dispatch<React.SetStateAction<boolean>>;
}

function CustomMagneticCursor({
  setSnappedButtonId,
  setIsSnappedClicking,
}: CustomMagneticCursorProps) {
  const [cursorType, setCursorType] = useState<'default' | 'button' | 'text'>('default');
  const [targetDims, setTargetDims] = useState({ width: 13, height: 13, radius: 9999 });
  const [isClicking, setIsClicking] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isFinePointer, setIsFinePointer] = useState(false);

  const mouseX = useMotionValue(-100);
  const mouseY = useMotionValue(-100);
  const snappedButtonRef = useRef<HTMLElement | null>(null);

  // Apple fluid spring for trailing magnetic cursor
  const springConfig = { stiffness: 600, damping: 32, mass: 0.4 };
  const smoothX = useSpring(mouseX, springConfig);
  const smoothY = useSpring(mouseY, springConfig);

  useEffect(() => {
    // Only activate custom cursor on fine pointer devices (desktop mouse/trackpad, not touch)
    const media = window.matchMedia('(pointer: fine)');
    setIsFinePointer(media.matches);
    const handler = (e: MediaQueryListEvent) => setIsFinePointer(e.matches);
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (!isFinePointer) return;

    const lastPointerPos = { x: -100, y: -100 };

    const updateTarget = (clientX: number, clientY: number) => {
      lastPointerPos.x = clientX;
      lastPointerPos.y = clientY;
      setIsVisible(true);

      const directTarget = document.elementFromPoint(clientX, clientY) as HTMLElement | null;

      if (directTarget) {
        const inputEl = directTarget.closest('input, textarea');
        if (inputEl) {
          snappedButtonRef.current = null;
          setSnappedButtonId(null);
          setCursorType('text');
          setTargetDims({ width: 3, height: 24, radius: 2 });
          mouseX.set(clientX);
          mouseY.set(clientY);
          return;
        }
      }

      // Check directly hovered button first
      let targetButton: HTMLElement | null =
        directTarget?.closest('button, [role="button"], a') || null;

      // Scan interactive buttons with generous, consistent 32px radial hit detection in every direction
      if (!targetButton) {
        const buttons = document.querySelectorAll<HTMLElement>('button, [role="button"]');
        let closestDist = Infinity;
        const SNAP_DISTANCE = 32;

        for (const btn of buttons) {
          const rect = btn.getBoundingClientRect();
          const dist = getDistanceToRect(clientX, clientY, rect);
          if (dist <= SNAP_DISTANCE && dist < closestDist) {
            closestDist = dist;
            targetButton = btn;
          }
        }
      }

      if (targetButton) {
        snappedButtonRef.current = targetButton;
        setSnappedButtonId(targetButton.id || null);
        setCursorType('button');
        const rect = targetButton.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        // True magnetic attraction: strong lock onto the button center (82% pull)
        const pull = 0.82;
        const magneticX = clientX + (centerX - clientX) * pull;
        const magneticY = clientY + (centerY - clientY) * pull;

        mouseX.set(magneticX);
        mouseY.set(magneticY);

        // Dynamically hug the button dimensions with rounded squircle
        const hugW = Math.min(Math.max(rect.width + 10, 36), 56);
        const hugH = Math.min(Math.max(rect.height + 10, 36), 56);
        setTargetDims({ width: hugW, height: hugH, radius: Math.min(rect.height / 2 + 4, 12) });
      } else {
        snappedButtonRef.current = null;
        setSnappedButtonId(null);
        setCursorType('default');
        setTargetDims({ width: 13, height: 13, radius: 9999 });
        mouseX.set(clientX);
        mouseY.set(clientY);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      updateTarget(e.clientX, e.clientY);
    };

    // Re-evaluate magnetic targeting smoothly as page scrolls with momentum
    const handleScroll = () => {
      if (lastPointerPos.x >= 0 && lastPointerPos.y >= 0) {
        updateTarget(lastPointerPos.x, lastPointerPos.y);
      }
    };

    // When cursor is magnetically snapped to a button, route all left clicks to that button
    const handleClickCapture = (e: MouseEvent) => {
      if (e.button !== 0) return; // Only route left clicks
      const snappedBtn = snappedButtonRef.current;
      if (!snappedBtn || !document.body.contains(snappedBtn)) return;

      const targetNode = e.target as Node | null;
      // If the click naturally hit inside the snapped button or its children, proceed normally
      if (targetNode && snappedBtn.contains(targetNode)) {
        return;
      }

      // If click landed within the magnetic snap radius (outside physical borders), route to snapped button
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      snappedBtn.click();
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 0) {
        setIsClicking(true);
        setIsSnappedClicking(true);
      }
    };
    const handleMouseUp = () => {
      setIsClicking(false);
      setIsSnappedClicking(false);
    };
    const handleMouseLeave = () => {
      setIsVisible(false);
      snappedButtonRef.current = null;
      setSnappedButtonId(null);
      setIsSnappedClicking(false);
    };
    const handleMouseEnter = () => setIsVisible(true);

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('click', handleClickCapture, { capture: true });
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mouseleave', handleMouseLeave);
    document.addEventListener('mouseenter', handleMouseEnter);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('click', handleClickCapture, { capture: true });
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mouseleave', handleMouseLeave);
      document.removeEventListener('mouseenter', handleMouseEnter);
    };
  }, [isFinePointer, mouseX, mouseY, setSnappedButtonId, setIsSnappedClicking]);

  if (!isFinePointer || !isVisible) return null;

  return (
    <motion.div
      style={{
        x: smoothX,
        y: smoothY,
        translateX: '-50%',
        translateY: '-50%',
      }}
      className="fixed top-0 left-0 pointer-events-none z-[999999] flex items-center justify-center select-none"
    >
      <motion.div
        animate={{
          width: isClicking ? targetDims.width * 0.8 : targetDims.width,
          height: isClicking ? targetDims.height * 0.8 : targetDims.height,
          borderRadius: targetDims.radius,
          backgroundColor:
            cursorType === 'text'
              ? '#000000'
              : cursorType === 'button'
              ? 'rgba(132, 228, 37, 0.28)'
              : '#000000',
          borderWidth: cursorType === 'button' ? 2 : 0,
          borderColor: '#000000',
          scale: isClicking ? 0.76 : 1,
        }}
        transition={{
          type: 'spring',
          stiffness: 500,
          damping: 28,
          mass: 0.45,
        }}
        className="flex items-center justify-center"
      >
        {cursorType === 'button' && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="w-1.5 h-1.5 rounded-full bg-black"
          />
        )}
      </motion.div>
    </motion.div>
  );
}

/**
 * Mathematical Easing Momentum Scroll:
 * Uses a requestAnimationFrame loop with Lenis's continuous exponential decay damping:
 * damp(current, target, lambda, dt) = lerp(current, target, 1 - exp(-lambda * dt))
 * Scroll velocity ramps up smoothly with mouse wheel inputs and glides to a stop using calculated friction.
 * Frame-by-frame continuous synchronization ensures zero stepped notches on mouse scroll wheels.
 */
function useLenisSmoothScroll() {
  useEffect(() => {
    // Unconditional mathematical momentum scrolling (reduced motion check bypassed per request)
    const lenis = new Lenis({
      lerp: 0.08, // Continuous frame-rate independent mathematical lerp
      wheelMultiplier: 1.0,
      touchMultiplier: 1.5,
      smoothWheel: true,
      syncTouch: true, // Smooth touch momentum
      syncTouchLerp: 0.075,
      touchInertiaExponent: 1.7,
      infinite: false,
      autoResize: true,
      respectReducedMotion: false, // Explicitly false so smooth momentum is always active
    });

    // Synchronize with GSAP ScrollTrigger if present
    lenis.on('scroll', () => {
      const globalScrollTrigger = (window as unknown as { ScrollTrigger?: { update?: () => void } }).ScrollTrigger;
      if (globalScrollTrigger && typeof globalScrollTrigger.update === 'function') {
        globalScrollTrigger.update();
      }
    });

    // Expose globally for GSAP integration or external debug/controls
    (window as unknown as { lenis?: Lenis }).lenis = lenis;

    let rafId: number;
    function raf(time: number) {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    }
    rafId = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(rafId);
      lenis.destroy();
      delete (window as unknown as { lenis?: Lenis }).lenis;
    };
  }, []);
}

export default function App() {
  useLenisSmoothScroll();

  const [tasks, setTasks] = useState<Task[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch {
      // fallback
    }
    return [];
  });

  const [inputVal, setInputVal] = useState('');
  const [shake, setShake] = useState(false);
  const [filter, setFilter] = useState<'all' | 'open' | 'done'>('all');
  const [snappedButtonId, setSnappedButtonId] = useState<string | null>(null);
  const [isSnappedClicking, setIsSnappedClicking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync tasks to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch {
      // ignore
    }
  }, [tasks]);

  // Current date string matching "THURSDAY 22 OCT"
  const formattedDate = React.useMemo(() => {
    const today = new Date();
    const weekday = today.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
    const day = today.getDate();
    const month = today.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
    return `${weekday} ${day} ${month}`;
  }, []);

  const openCount = tasks.filter((t) => !t.completed).length;
  const doneCount = tasks.filter((t) => t.completed).length;

  const filteredTasks = tasks.filter((t) => {
    if (filter === 'open') return !t.completed;
    if (filter === 'done') return t.completed;
    return true;
  });

  const handleAddTask = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = inputVal.trim();
    if (!trimmed) {
      setShake(true);
      setTimeout(() => setShake(false), 450);
      inputRef.current?.focus();
      return;
    }

    const newTask: Task = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 7)}`,
      text: trimmed,
      completed: false,
      createdAt: Date.now(),
    };

    setTasks((prev) => [newTask, ...prev]);
    setInputVal('');
    inputRef.current?.focus();
  };

  const toggleTask = (id: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t))
    );
  };

  const deleteTask = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (snappedButtonId === `del-btn-${id}`) {
      setSnappedButtonId(null);
    }
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const formatTwoDigits = (num: number) => {
    return String(num).padStart(2, '0');
  };

  return (
    <div className="relative min-h-screen min-h-[100dvh] w-full bg-[#F5F4EE] text-black overflow-x-hidden selection:bg-[#84E425] selection:text-black">
      {/* Custom Fluid Magnetic Apple Cursor (active by default, hidden on touch screens) */}
      <CustomMagneticCursor
        snappedButtonId={snappedButtonId}
        setSnappedButtonId={setSnappedButtonId}
        isSnappedClicking={isSnappedClicking}
        setIsSnappedClicking={setIsSnappedClicking}
      />

      {/* Background Architectural Ruled Grid Lines - full bleed on all screen sizes */}
      <motion.div
        aria-hidden="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.9 }}
        transition={{ duration: 1.8, ease: APPLE_EASE }}
        className="fixed inset-0 pointer-events-none z-0 flex w-full h-full select-none"
      >
        {/* Mobile: 6 columns evenly distributed from edge to edge without wrapping */}
        <div className="flex sm:hidden w-full h-full">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex-1 h-full border-r border-black/[0.045] last:border-r-0"
            />
          ))}
        </div>

        {/* Tablet & Desktop: 12 columns evenly distributed */}
        <div className="hidden sm:flex w-full h-full">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="flex-1 h-full border-r border-black/[0.045] last:border-r-0"
            />
          ))}
        </div>
      </motion.div>

      {/* Outer Content Wrap */}
      <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-8 md:px-12 pt-8 sm:pt-14 pb-28">
        {/* Top Header */}
        <header className="pb-6 sm:pb-8 relative">
          <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-6 sm:gap-4">
            {/* Title: TO—DO */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: APPLE_EASE }}
              className="flex items-center"
            >
              <h1 className="font-heading-brutal text-6xl sm:text-7xl md:text-8xl lg:text-9xl tracking-tighter text-black select-none flex items-center leading-none">
                <span>TO</span>
                {/* Slower, luxurious expanding lime dash */}
                <motion.span
                  aria-hidden="true"
                  style={{ backgroundColor: LIME_ACCENT }}
                  initial={{ scaleX: 0, originX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 1.4, ease: APPLE_EASE, delay: 0.15 }}
                  className="inline-block h-[0.16em] w-[0.8em] sm:w-[0.95em] md:w-[1.1em] mx-1.5 sm:mx-2.5 align-middle self-center shrink-0 origin-left"
                />
                <span>DO</span>
              </h1>
            </motion.div>

            {/* Date & Dual Counter Box */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: APPLE_EASE, delay: 0.1 }}
              className="flex flex-col items-start sm:items-end w-full sm:w-auto"
            >
              <div className="text-[11px] sm:text-xs font-mono-brutal font-bold tracking-widest text-neutral-800 uppercase mb-2 select-none">
                {formattedDate}
              </div>

              {/* Counter Box with High-Contrast Bold Selection States */}
              <div className="flex border-2 sm:border-[2.5px] border-black divide-x-2 sm:divide-x-[2.5px] divide-black select-none shadow-[3px_3px_0px_#000000] overflow-hidden transition-all">
                {/* OPEN Button / Box */}
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.95 }}
                  transition={APPLE_SPRING}
                  onClick={() => setFilter(filter === 'open' ? 'all' : 'open')}
                  title={filter === 'open' ? 'Click to show all tasks' : 'Filter open tasks'}
                  className={`relative flex flex-col items-center justify-center min-w-[76px] sm:min-w-[86px] pt-1.5 sm:pt-2 pb-2 sm:pb-2.5 px-3 sm:px-4 cursor-pointer transition-all duration-200 ${
                    filter === 'open'
                      ? 'bg-black text-white'
                      : filter === 'done'
                      ? 'bg-white/60 text-black/40'
                      : 'bg-white text-black hover:bg-neutral-100'
                  }`}
                >
                  <div className="flex items-center gap-1">
                    {filter === 'open' && (
                      <span className="w-1.5 h-1.5 rounded-full bg-[#84E425] animate-pulse shrink-0" />
                    )}
                    <span
                      className={`text-[9px] sm:text-[10px] font-mono-brutal font-bold tracking-wider uppercase ${
                        filter === 'open' ? 'text-[#84E425]' : 'text-black'
                      }`}
                    >
                      OPEN
                    </span>
                  </div>
                  <div className="overflow-hidden h-8 sm:h-9 flex items-center justify-center">
                    <motion.span
                      key={`open-${openCount}`}
                      initial={{ y: -16, opacity: 0, scale: 0.9 }}
                      animate={{ y: 0, opacity: 1, scale: 1 }}
                      transition={APPLE_BOUNCE_SPRING}
                      className={`text-2xl sm:text-3xl font-black font-mono-brutal leading-tight inline-block ${
                        filter === 'open' ? 'text-white' : 'text-black'
                      }`}
                    >
                      {formatTwoDigits(openCount)}
                    </motion.span>
                  </div>
                </motion.button>

                {/* DONE Button / Box */}
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.95 }}
                  transition={APPLE_SPRING}
                  onClick={() => setFilter(filter === 'done' ? 'all' : 'done')}
                  title={filter === 'done' ? 'Click to show all tasks' : 'Filter completed tasks'}
                  style={{
                    backgroundColor:
                      filter === 'done'
                        ? '#000000'
                        : filter === 'open'
                        ? 'rgba(132, 228, 37, 0.45)'
                        : LIME_ACCENT,
                  }}
                  className={`relative flex flex-col items-center justify-center min-w-[76px] sm:min-w-[86px] pt-1.5 sm:pt-2 pb-2 sm:pb-2.5 px-3 sm:px-4 cursor-pointer transition-all duration-200 ${
                    filter === 'done' ? 'text-white' : filter === 'open' ? 'text-black/50' : 'text-black'
                  }`}
                >
                  <div className="flex items-center gap-1">
                    {filter === 'done' && (
                      <span className="w-1.5 h-1.5 rounded-full bg-[#84E425] animate-pulse shrink-0" />
                    )}
                    <span
                      className={`text-[9px] sm:text-[10px] font-mono-brutal font-bold tracking-wider uppercase ${
                        filter === 'done' ? 'text-[#84E425]' : 'text-black'
                      }`}
                    >
                      DONE
                    </span>
                  </div>
                  <div className="overflow-hidden h-8 sm:h-9 flex items-center justify-center">
                    <motion.span
                      key={`done-${doneCount}`}
                      initial={{ y: -16, opacity: 0, scale: 0.9 }}
                      animate={{ y: 0, opacity: 1, scale: 1 }}
                      transition={APPLE_BOUNCE_SPRING}
                      className={`text-2xl sm:text-3xl font-black font-mono-brutal leading-tight inline-block ${
                        filter === 'done' ? 'text-[#84E425]' : 'text-black'
                      }`}
                    >
                      {formatTwoDigits(doneCount)}
                    </motion.span>
                  </div>
                </motion.button>
              </div>
            </motion.div>
          </div>

          {/* Slower, ultra-smooth cutting line drawing from left to right */}
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{
              duration: 1.6,
              ease: APPLE_EASE,
              delay: 0.1,
            }}
            className="absolute bottom-0 left-0 right-0 h-[2px] sm:h-[2.5px] bg-black origin-left pointer-events-none"
          />
        </header>

        {/* Inner Content Block: Input Box, Index Bar, Content */}
        <div className="max-w-2xl mx-auto">
          {/* Brutalist Input Box with Lime Background Container Behind Button (Zero White Exposed) */}
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: APPLE_EASE, delay: 0.25 }}
            className="mt-10 sm:mt-14 mb-8 sm:mb-12"
          >
            <form
              onSubmit={handleAddTask}
              className={`flex items-stretch border-2 sm:border-[2.5px] border-black bg-white shadow-[5px_5px_0px_#000000] sm:shadow-[6px_6px_0px_#000000] focus-within:shadow-[8px_8px_0px_#000000] focus-within:-translate-y-[2px] transition-all duration-300 ${
                shake ? 'animate-shake' : ''
              }`}
            >
              <input
                ref={inputRef}
                type="text"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                placeholder="Write a task..."
                className="flex-1 bg-white px-4 sm:px-6 py-3.5 sm:py-4 text-base sm:text-lg font-medium text-black placeholder:text-neutral-500 placeholder:font-normal focus:outline-none min-w-0"
              />
              {/* Lime-backed container prevents white space from showing when button moves down */}
              <div
                style={{ backgroundColor: LIME_ACCENT }}
                className="relative border-l-2 sm:border-l-[2.5px] border-black overflow-hidden flex items-stretch shrink-0"
              >
                <motion.button
                  type="submit"
                  whileHover={{ filter: 'brightness(0.96)' }}
                  whileTap={{ y: 2, filter: 'brightness(0.92)' }}
                  transition={APPLE_SPRING}
                  style={{ backgroundColor: LIME_ACCENT }}
                  className="px-6 sm:px-8 py-3.5 sm:py-4 font-black font-mono-brutal tracking-wider text-xs sm:text-sm uppercase text-black cursor-pointer flex items-center justify-center gap-1 select-none w-full h-full"
                >
                  ADD +
                </motion.button>
              </div>
            </form>
          </motion.section>

          {/* Subheader: Clean INDEX and TOTAL (No [RESET] badges) */}
          <motion.section
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.35 }}
          >
            <div className="relative pb-1.5">
              <div className="flex items-center justify-between font-mono-brutal text-[11px] sm:text-xs font-bold tracking-widest text-black uppercase">
                <button
                  type="button"
                  onClick={() => setFilter('all')}
                  className="cursor-pointer hover:underline flex items-center gap-1.5 select-none transition-opacity hover:opacity-75"
                >
                  <span>INDEX</span>
                </button>
                <div className="overflow-hidden">
                  <motion.span
                    key={tasks.length}
                    initial={{ y: -10, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={APPLE_SPRING}
                    className="select-none inline-block"
                  >
                    {tasks.length} TOTAL
                  </motion.span>
                </div>
              </div>

              {/* Slower, graceful cutting line under INDEX */}
              <motion.div
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{
                  duration: 1.5,
                  ease: APPLE_EASE,
                  delay: 0.35,
                }}
                className="absolute bottom-0 left-0 right-0 h-[2px] sm:h-[2.5px] bg-black origin-left pointer-events-none"
              />
            </div>

            {/* Empty State & Task List Content */}
            <div className="relative">
              <AnimatePresence mode="wait">
                {tasks.length === 0 ? (
                  /* Empty State: exactly matching the attached image with swift, smooth presentation */
                  <motion.div
                    key="empty-state"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, transition: { duration: 0.18 } }}
                    transition={{ duration: 0.35, ease: APPLE_EASE }}
                    className="pt-10 sm:pt-14 select-none"
                  >
                    <h2 className="outlined-brutalist text-6xl sm:text-7xl md:text-8xl lg:text-9xl uppercase leading-[0.95] tracking-tight">
                      NOTHING
                      <br />
                      HERE.
                    </h2>
                    <motion.p
                      onClick={() => inputRef.current?.focus()}
                      whileHover={{ x: 4 }}
                      className="group mt-6 sm:mt-8 font-mono-brutal text-xs sm:text-sm text-neutral-600 flex items-center gap-1.5 cursor-pointer hover:text-black transition-colors"
                    >
                      <span>Type something above and hit Enter</span>
                      <span className="inline-block transition-transform duration-300 ease-out group-hover:translate-x-1.5 group-hover:-translate-y-1">
                        ↗
                      </span>
                    </motion.p>
                  </motion.div>
                ) : filteredTasks.length === 0 ? (
                  /* Filter Empty State */
                  <motion.div
                    key="filter-empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="py-12 text-center font-mono-brutal"
                  >
                    <p className="text-sm text-neutral-500 uppercase tracking-widest">
                      No {filter} tasks found.
                    </p>
                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => setFilter('all')}
                      className="mt-3 text-xs font-bold uppercase underline tracking-wider cursor-pointer hover:text-black"
                    >
                      Show all tasks
                    </motion.button>
                  </motion.div>
                ) : (
                  /* Task List with Hardware-Accelerated Layout Glide (Zero Jitter) */
                  <motion.div
                    key="task-list-wrapper"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0.15 } }}
                    transition={{ duration: 0.2 }}
                  >
                    <ul className="mt-1 relative">
                      <AnimatePresence mode="popLayout">
                        {filteredTasks.map((task, index) => {
                          const itemNumber = formatTwoDigits(index + 1);
                          const isDelSnapped = snappedButtonId === `del-btn-${task.id}`;
                          const isChkSnapped = snappedButtonId === `chk-btn-${task.id}`;
                          return (
                            <motion.li
                              key={task.id}
                              layout="position"
                              initial={{ opacity: 0, y: -14 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{
                                opacity: 0,
                                transition: { duration: 0.14, ease: 'easeOut' },
                              }}
                              transition={{
                                opacity: { duration: 0.2, ease: 'easeOut' },
                                y: { type: 'spring', stiffness: 450, damping: 28 },
                                layout: LAYOUT_GLIDE_SPRING,
                              }}
                              className="w-full border-b-2 border-black/15 py-3.5 sm:py-4 px-2 hover:bg-black/[0.02] transition-colors select-none"
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3 sm:gap-4 min-w-0 pr-3">
                                  {/* Number Index */}
                                  <span className="font-mono-brutal text-xs font-bold text-neutral-400 shrink-0 min-w-[20px]">
                                    {itemNumber}
                                  </span>

                                  {/* Fluid Brutalist Checkbox Button (Magnetic snap target) */}
                                  <motion.button
                                    id={`chk-btn-${task.id}`}
                                    type="button"
                                    onClick={() => toggleTask(task.id)}
                                    title={task.completed ? "Mark task as open" : "Mark task as completed"}
                                    animate={
                                      isChkSnapped
                                        ? isSnappedClicking
                                          ? { scale: 0.88, backgroundColor: task.completed ? LIME_ACCENT : '#FFFFFF' }
                                          : { scale: 1.15, backgroundColor: task.completed ? LIME_ACCENT : '#FFFFFF' }
                                        : { scale: 1, backgroundColor: task.completed ? LIME_ACCENT : '#FFFFFF' }
                                    }
                                    whileHover={{ scale: 1.15 }}
                                    whileTap={{ scale: 0.88 }}
                                    transition={APPLE_BOUNCE_SPRING}
                                    className="w-5 h-5 sm:w-6 sm:h-6 border-2 border-black flex items-center justify-center shrink-0 cursor-pointer"
                                  >
                                    <AnimatePresence>
                                      {task.completed && (
                                        <motion.svg
                                          key="check-icon"
                                          initial={{ scale: 0, opacity: 0 }}
                                          animate={{ scale: 1, opacity: 1 }}
                                          exit={{ scale: 0, opacity: 0 }}
                                          transition={APPLE_BOUNCE_SPRING}
                                          className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-black stroke-[3.5]"
                                          fill="none"
                                          viewBox="0 0 24 24"
                                          stroke="currentColor"
                                        >
                                          <motion.path
                                            initial={{ pathLength: 0 }}
                                            animate={{ pathLength: 1 }}
                                            transition={{ duration: 0.24, ease: APPLE_EASE }}
                                            strokeLinecap="square"
                                            strokeLinejoin="miter"
                                            d="M5 13l4 4L19 7"
                                          />
                                        </motion.svg>
                                      )}
                                    </AnimatePresence>
                                  </motion.button>

                                  {/* Task Text with animated fluid strikethrough line */}
                                  <div className="relative inline-block break-all">
                                    <motion.span
                                      animate={{
                                        color: task.completed ? '#a3a3a3' : '#000000',
                                      }}
                                      transition={{ duration: 0.25, ease: APPLE_EASE }}
                                      className="text-base sm:text-lg font-medium tracking-tight block"
                                    >
                                      {task.text}
                                    </motion.span>
                                    {/* Animated drawing strike line */}
                                    <motion.div
                                      initial={{ scaleX: 0 }}
                                      animate={{ scaleX: task.completed ? 1 : 0 }}
                                      transition={{ duration: 0.28, ease: APPLE_EASE }}
                                      className="absolute left-0 right-0 top-1/2 h-[2px] bg-neutral-400 origin-left pointer-events-none"
                                    />
                                  </div>
                                </div>

                                {/* Delete Button: Non-rotating bouncy button with rotating cross inside */}
                                <motion.button
                                  id={`del-btn-${task.id}`}
                                  type="button"
                                  animate={
                                    isDelSnapped
                                      ? isSnappedClicking
                                        ? 'btnTap'
                                        : 'btnHover'
                                      : undefined
                                  }
                                  whileHover="btnHover"
                                  whileTap="btnTap"
                                  initial="btnInitial"
                                  variants={{
                                    btnInitial: { scale: 1, backgroundColor: 'rgba(0,0,0,0)', color: '#000000' },
                                    btnHover: { scale: 1.15, backgroundColor: '#000000', color: '#ffffff' },
                                    btnTap: { scale: 0.82, backgroundColor: '#000000', color: '#ffffff' },
                                  }}
                                  transition={BOUNCY_BUTTON_SPRING}
                                  onClick={(e) => deleteTask(task.id, e)}
                                  title="Delete task"
                                  className={`w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center cursor-pointer shrink-0 border transition-colors ${
                                    isDelSnapped
                                      ? 'opacity-100 border-black'
                                      : 'opacity-60 group-hover:opacity-100 hover:border-black border-transparent'
                                  }`}
                                >
                                  <motion.span
                                    variants={{
                                      btnInitial: { rotate: 0 },
                                      btnHover: { rotate: 90 },
                                      btnTap: { rotate: 180 },
                                    }}
                                    transition={{ type: 'spring', stiffness: 450, damping: 18 }}
                                    className="font-mono-brutal text-lg sm:text-xl font-bold leading-none inline-block select-none pointer-events-none"
                                  >
                                    ×
                                  </motion.span>
                                </motion.button>
                              </div>
                            </motion.li>
                          );
                        })}
                      </AnimatePresence>
                    </ul>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.section>
        </div>
      </div>
    </div>
  );
}
