import confetti from "canvas-confetti";

export function celebrateSmall() {
  confetti({
    particleCount: 40,
    spread: 70,
    origin: { y: 0.75 },
  });
}

export function celebrateBigFireworks() {
  const bursts = 6;
  for (let i = 0; i < bursts; i += 1) {
    setTimeout(() => {
      confetti({
        particleCount: 120,
        spread: 120,
        startVelocity: 45,
        origin: { x: Math.random() * 0.8 + 0.1, y: 0.8 },
      });
    }, i * 220);
  }
}
