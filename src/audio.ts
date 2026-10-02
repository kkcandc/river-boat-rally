export class AudioBus {
  muted = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engine: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private waterGain: GainNode | null = null;

  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.9;
    master.connect(ctx.destination);
    this.master = master;

    const engine = ctx.createOscillator();
    engine.type = "sawtooth";
    engine.frequency.value = 70;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 280;
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0.0;
    engine.connect(filter);
    filter.connect(engineGain);
    engineGain.connect(master);
    engine.start();
    this.engine = engine;
    this.engineGain = engineGain;
    this.engineFilter = filter;

    const rate = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, rate, rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < rate; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const waterFilter = ctx.createBiquadFilter();
    waterFilter.type = "bandpass";
    waterFilter.frequency.value = 900;
    waterFilter.Q.value = 0.7;
    const waterGain = ctx.createGain();
    waterGain.gain.value = 0.0;
    noise.connect(waterFilter);
    waterFilter.connect(waterGain);
    waterGain.connect(master);
    noise.start();
    this.waterGain = waterGain;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
    }
  }

  setDrive(speed: number, boosting: boolean): void {
    if (!this.ctx || !this.engine || !this.engineGain || !this.engineFilter || !this.waterGain) return;
    const t = this.ctx.currentTime;
    this.engine.frequency.setTargetAtTime(62 + speed * 2.4 + (boosting ? 36 : 0), t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(220 + speed * 8 + (boosting ? 400 : 0), t, 0.08);
    this.engineGain.gain.setTargetAtTime(0.012 + Math.min(0.03, speed * 0.0007), t, 0.08);
    this.waterGain.gain.setTargetAtTime(0.008 + Math.min(0.04, speed * 0.0009), t, 0.1);
  }

  beep(freq = 520, dur = 0.12): void {
    this.tone(freq, dur, "square", 0.05);
  }

  go(): void {
    this.tone(660, 0.16, "square", 0.06);
  }

  pickup(): void {
    this.tone(880, 0.09, "sine", 0.05);
    this.tone(1320, 0.12, "sine", 0.03);
  }

  boost(): void {
    this.tone(180, 0.18, "sawtooth", 0.04);
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start();
    osc.stop(this.ctx.currentTime + dur + 0.02);
  }
}
