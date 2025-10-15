// SplashScreenRN.js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet, Animated, Easing } from 'react-native';

export default function SplashScreenRN({
    onDone,
    minDuration = 2000,
    brandBg = '#6A0DAD',
    brandText = '#FFFFFF',
    primary = '#FFFFFF',
    logoSource,
    brandName = 'wizmarket',
}) {
    const [visible, setVisible] = useState(true);
    const fade = useRef(new Animated.Value(0)).current;

    const dots = useMemo(() => [0, 1, 2].map(() => ({
        o: new Animated.Value(0.3),
        y: new Animated.Value(0),
    })), []);

    useEffect(() => {
        const start = Date.now();
        Animated.timing(fade, { toValue: 1, duration: 240, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();

        dots.forEach((d, i) => {
            const loop = Animated.loop(Animated.sequence([
                Animated.parallel([
                    Animated.timing(d.o, { toValue: 1, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
                    Animated.timing(d.y, { toValue: -3, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
                ]),
                Animated.parallel([
                    Animated.timing(d.o, { toValue: 0.3, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
                    Animated.timing(d.y, { toValue: 0, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
                ]),
            ]));
            setTimeout(() => loop.start(), i * 150);
        });

        const finish = () => {
            const remain = Math.max(0, minDuration - (Date.now() - start));
            setTimeout(() => {
                Animated.timing(fade, { toValue: 0, duration: 220, easing: Easing.out(Easing.ease), useNativeDriver: true })
                    .start(() => { setVisible(false); onDone?.(); });
            }, remain);
        };
        finish();
    }, [minDuration]);

    if (!visible) return null;

    return (
        <Animated.View style={[styles.wrap, { backgroundColor: brandBg, opacity: fade }]} accessibilityRole="alert">
            {logoSource ? <Image source={logoSource} style={styles.logo} resizeMode="contain" /> : null}
            <Text style={[styles.brand, { color: brandText }]}>{brandName}</Text>
            <View style={styles.dots}>
                {dots.map((d, idx) => (
                    <Animated.View key={idx} style={[styles.dot, { backgroundColor: primary, opacity: d.o, transform: [{ translateY: d.y }] }]} />
                ))}
            </View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    wrap: { position: 'absolute', inset: 0, zIndex: 9999, justifyContent: 'center', alignItems: 'center', gap: 14 },
    logo: { width: 96, height: 96, borderRadius: 20 },
    brand: { fontWeight: '900', letterSpacing: -0.5, fontSize: 20 },
    dots: { flexDirection: 'row', gap: 6, marginTop: 6 },
    dot: { width: 6, height: 6, borderRadius: 3 },
});
