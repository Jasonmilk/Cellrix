// web-ui/src/components/HolographicGrid.tsx
// English comments & code

import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { HolographicTheme } from './HolographicTerminal';

interface HolographicGridProps {
    slotRects: any;
    theme: HolographicTheme;
}

/// Renders 3D holographic wireframe panels on the active canvas.
export const HolographicGrid: React.FC<HolographicGridProps> = ({ slotRects, theme }) => {
    const groupRef = useRef<THREE.Group>(null);

    // Sinusoidal levitation driven entirely by external theme configuration. Zero magic numbers!
    useFrame(({ clock }) => {
        if (groupRef.current) {
            const time = clock.getElapsedTime();
            groupRef.current.position.y = Math.sin(time * theme.waveSpeed) * theme.waveAmplitude;
        }
    });

    return (
        <group ref={groupRef}>
            {slotRects.map(([id, rect]: [string, any]) => (
                <mesh 
                    key={id} 
                    position={[
                        rect.x * theme.scaleFactor + theme.offsetX, 
                        0, 
                        rect.y * theme.scaleFactor + theme.offsetZ
                    ]}
                >
                    <planeGeometry args={[rect.width * theme.scaleFactor, rect.height * theme.scaleFactor]} />
                    <meshBasicMaterial 
                        color={theme.gridColor} 
                        transparent 
                        opacity={theme.gridOpacity} 
                        wireframe 
                    />
                </mesh>
            ))}
        </group>
    );
};
