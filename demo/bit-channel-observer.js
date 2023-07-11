export class BitChannelObserver {
  #lastTimestamp;
  #lastState = 1;
  #millis = [0, 0, 0]; // zero, reset, one
  #handler;
  #observer;

  constructor(fn) {
    this.#handler = fn;
    let lastValue = -1;

    const map = state => {
      switch(state) {
        case "nominal":
        case "fair":
          return 0;
        case "serious":
          return 1;
        case "critical":
          return 2;
      }
    }

    this.#observer = new PressureObserver(changes => {
      let value = map(changes[0].state);
      if (value !== lastValue) {
        this.#process(value);
      }
      lastValue = value;
    });
  }

  async observe() {
    this.#lastTimestamp = performance.now();
    return await this.#observer.observe("cpu");
  }

  #process(state) {
    let start = this.#lastTimestamp;
    this.#lastTimestamp = performance.now();
    let time = (this.#lastTimestamp - start);
  
    this.#millis[this.#lastState] += time;
    this.#lastState = state;
  
    if (this.#millis[1] > 6_000) {
      const toDispatch = this.#millis[0] > this.#millis[2] ? 0 : 1;
      this.#handler(toDispatch);
      this.#millis = [0, 0, 0];
    }
  }
}