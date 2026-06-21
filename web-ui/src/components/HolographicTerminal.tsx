// web-ui/src/components/HolographicTerminal.tsx
// English comments & code

import React, { useEffect, useState, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import init, { compute_layout } from 'cellrix-layout-wasm';

import { DataSource } from '../data/DataSource';
import { HolographicGrid } from './HolographicGrid';

/// High-performance layout configurations. Zero magic numbers.
pub interface LayoutDimensionsConfig {
    characterWidthPx: number;
    characterHeightPx: number;
    minGridWidth: number;       // Bleed safety limit (e.g. 20 chars)
    minGridHeight: number;      // Bleed safety limit (e.g. 10 chars)
    resizeThreshold: number;    // Damping threshold: rebuild only if delta exceeds this (e.g. 5 chars)
}

/// Visual theme parameters. Zero magic values.
pub interface HolographicTheme {
    backgroundColor: string;
    ambientIntensity: number;
    bloomThreshold: number;
    bloomGain: number;
    cameraPosition: [number, number, number];
    cameraFov: number;
    gridColor: string;
    gridOpacity: number;
    scaleFactor: number;
    offsetX: number;
    offsetZ: number;
    waveAmplitude: number; // Configurable levitation amplitude
    waveSpeed: number;     // Configurable levitation speed
}

interface HolographicTerminalProps {
    dataSource: DataSource;
    dimensions: LayoutDimensionsConfig;
    theme: HolographicTheme;
}

/// Robust, production-ready 3D Viewport.
/// Safe against WASM failures, network collapses, and rendering dimension overflows.
pub const HolographicTerminal: React.FC<HolographicTerminalProps> = ({
    dataSource,
    dimensions,
    theme,
}) => {
    const [layout, setLayout] = useState<any>(null);
    const [wasmReady, setWasmReady] = useState(false);
    
    // Fallback States: capture errors gracefully without crashing the UI thread!
    const [wasmError, setWasmError] = useState<string | null>(null);
    const [pipelineError, setPipelineError] = useState<string | null>(null);

    // Track active grid dimensions inside refs to avoid unnecessary React re-renders on minor resize shakes
    const gridWidthRef = useRef<number>(0);
    const gridHeightRef = useRef<number>(0);
    const [resizeTrigger, setResizeTrigger] = useState<number>(0);

    // Initialize WebAssembly engine with fallback recovery
    useEffect(() => {
        init()
            .then(() => setWasmReady(true))
            .catch((err) => {
                console.error("Fatal: WebAssembly initialization failed:", err);
                setWasmError(err.message || "WASM module failed to load.");
            });
    }, []);

    // Evade micro-resize shivers (Avoid over-precision. Recompute only if delta >= resizeThreshold)
    useEffect(() => {
        const handleResize = () => {
            const currentWidth = Math.max(
                dimensions.minGridWidth,
                Math.floor(window.innerWidth / dimensions.characterWidthPx)
            );
            const currentHeight = Math.max(
                dimensions.minGridHeight,
                Math.floor(window.innerHeight / dimensions.characterHeightPx)
            );

            // Evade minor shivers: compare absolute differences
            const deltaW = Math.abs(currentWidth - gridWidthRef.current);
            const deltaH = Math.abs(currentHeight - gridHeightRef.current);

            if (gridWidthRef.current === 0 || deltaW >= dimensions.resizeThreshold || deltaH >= dimensions.resizeThreshold) {
                gridWidthRef.current = currentWidth;
                gridHeightRef.current = currentHeight;
                setResizeTrigger(prev => prev + 1); // Trigger layout recalculation on threshold breach
            }
        };

        window.addEventListener('resize', handleResize);
        handleResize(); // Initial measurement

        return () => window.removeEventListener('resize', handleResize);
    }, [dimensions]);

    // Bind layout calculation with viewport sizing and data streams
    useEffect(() => {
        if (!wasmReady) return;

        const unsubscribe = dataSource.subscribe((snapshot) => {
            if (snapshot.type === "connection_lost") {
                setPipelineError(snapshot.message);
                return;
            }

            try {
                // Run mathematical layout engine inside WASM using our highly dampened dimensions
                const output = compute_layout(snapshot, gridWidthRef.current, gridHeightRef.current);
                
                setLayout(output);
                setPipelineError(null); 
            } catch (err) {
                // Visual Fault-Tolerance: Log error but keep the last valid layout to avoid screen flickers
                console.warn("WASM Layout compute failed. Retaining previous frame.", err);
                setPipelineError(`Layout Computation Suspended: ${(err as Error).message}`);
            }
        });

        return unsubscribe;
    }, [wasmReady, dataSource, resizeTrigger]);

    // Render Graceful Degradation UI on WASM failure
    if (wasmError) {
        return (
            <div style={{ 
                width: '100vw', height: '100vh', 
                backgroundColor: '#1C1917', color: '#EF4444',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'monospace', gap: '20px'
            }}>
                <h3>🚨 WASM ENGINE INITIALIZATION FAILED</h3>
                <code style={{ background: '#0c0a09', padding: '10px', borderRadius: '4px' }}>{wasmError}</code>
                <button 
                    onClick={() => window.location.reload()}
                    style={{ 
                        background: '#EF4444', color: '#1C1917', border: 'none', 
                        padding: '10px 20px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' 
                    }}
                >
                    RETRY BOOTSTRAP
                </button>
            </div>
        );
    }

    if (!layout) {
        return (
            <div style={{ 
                width: '100vw', height: '100vh', 
                backgroundColor: theme.backgroundColor, color: theme.gridColor,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'monospace'
            }}>
                Initializing Holographic Grid...
            </div>
        );
    }

    return (
        <div style={{ width: '100vw', height: '100vh', backgroundColor: theme.backgroundColor, position: 'relative' }}>
            {/* Transient Alert Bar for non-fatal stream errors (Graceful notification) */}
            {pipelineError && (
                <div style={{
                    position: 'absolute', top: '10px', left: '50%', transform: 'translateX(-50%)',
                    backgroundColor: 'rgba(239, 68, 68, 0.9)', color: '#1C1917', zIndex: 100,
                    padding: '8px 16px', borderRadius: '4px', fontFamily: 'monospace', fontSize: '12px',
                    fontWeight: 'bold', boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
                }}>
                    ⚠️ {pipelineError}
                </div>
            )}

            <Canvas camera={{ position: theme.cameraPosition, fov: theme.cameraFov }}>
                <ambientLight intensity={theme.ambientIntensity} />
                <HolographicGrid slotRects={layout.slot_rects} theme={theme} />
                <EffectComposer>
                    <Bloom 
                        luminanceThreshold={theme.bloomThreshold} 
                        luminanceGain={theme.bloomGain} 
                    />
                </EffectComposer>
            </Canvas>
        </div>
    );
};
