export class Input {
  forward = false;
  brake = false;
  steer = 0;
  boostEdge = false;

  private keys = new Set<string>();
  private stick = 0;
  private boostHeld = false;
  private brakeHeld = false;
  private boostLatch = false;
  private stickPointer = -1;

  constructor() {
    window.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());

    const stick = document.getElementById("stick");
    const knob = document.getElementById("knob");
    const boost = document.getElementById("boostPad");
    const brake = document.getElementById("brakePad");

    if (stick && knob) {
      const move = (clientX: number) => {
        const rect = stick.getBoundingClientRect();
        const dx = clientX - (rect.left + rect.width / 2);
        this.stick = Math.max(-1, Math.min(1, dx / (rect.width * 0.34)));
        knob.style.transform = `translateX(${this.stick * rect.width * 0.28}px)`;
      };
      stick.addEventListener("pointerdown", (e) => {
        this.stickPointer = e.pointerId;
        stick.setPointerCapture(e.pointerId);
        move(e.clientX);
      });
      stick.addEventListener("pointermove", (e) => {
        if (e.pointerId !== this.stickPointer) return;
        move(e.clientX);
      });
      const end = (e: PointerEvent) => {
        if (e.pointerId !== this.stickPointer) return;
        this.stickPointer = -1;
        this.stick = 0;
        knob.style.transform = "translateX(0)";
      };
      stick.addEventListener("pointerup", end);
      stick.addEventListener("pointercancel", end);
    }

    const hold = (el: HTMLElement | null, set: (v: boolean) => void) => {
      if (!el) return;
      const down = (e: PointerEvent) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        set(true);
      };
      el.addEventListener("pointerdown", down);
      el.addEventListener("pointerup", () => set(false));
      el.addEventListener("pointercancel", () => set(false));
      el.addEventListener("pointerleave", () => set(false));
    };
    hold(boost, (v) => {
      this.boostHeld = v;
    });
    hold(brake, (v) => {
      this.brakeHeld = v;
    });
  }

  /** Call once per frame. `autoThrottle` keeps mobile boats at full pace. */
  poll(autoThrottle: boolean): void {
    let steer = this.stick;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) steer -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) steer += 1;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let padForward = false;
    let padBrake = false;
    let padBoost = false;
    for (const pad of pads) {
      if (!pad) continue;
      const axis = pad.axes[0] ?? 0;
      if (Math.abs(axis) > 0.18) steer += axis;
      if ((pad.buttons[7]?.value ?? 0) > 0.25 || pad.buttons[0]?.pressed) padForward = true;
      if ((pad.buttons[6]?.value ?? 0) > 0.25 || pad.buttons[1]?.pressed) padBrake = true;
      if (pad.buttons[2]?.pressed || pad.buttons[5]?.pressed) padBoost = true;
    }
    this.steer = Math.max(-1, Math.min(1, steer));
    this.forward = autoThrottle || this.keys.has("KeyW") || this.keys.has("ArrowUp") || padForward;
    this.brake = this.brakeHeld || this.keys.has("KeyS") || this.keys.has("ArrowDown") || padBrake;
    const boostDown = this.boostHeld || this.keys.has("Space") || this.keys.has("ShiftLeft") || padBoost;
    this.boostEdge = boostDown && !this.boostLatch;
    this.boostLatch = boostDown;
  }

  consumeStart(): boolean {
    return (
      this.keys.has("Enter") ||
      this.keys.has("Space") ||
      this.boostHeld ||
      this.stick !== 0
    );
  }
}
