// Mandelbrot using Webworkers
// Author: Peter Jensen, Intel Corporation

const $ = id => document.getElementById(id);

// global variables
var max_iterations = 100;
var worker_count   = 0;

class Mandelbrot {
  #ctx;
  #imageData;

  width;
  height;

  constructor(canvas_id) {
    const canvas = document.getElementById(canvas_id);
    this.#ctx = canvas.getContext("2d");
    this.width = canvas.width;
    this.height = canvas.height;
    this.#imageData = this.#ctx.getImageData(0, 0, this.width, this.height);
  }

  clear() {
    for (var i = 0; i < this.#imageData.data.length; i = i + 4) {
      this.#imageData.data[i] = 0;
      this.#imageData.data[i + 1] = 0;
      this.#imageData.data[i + 2] = 0;
      this.#imageData.data[i + 3] = 255;
    }
  }

  update() {
    this.#ctx.putImageData(this.#imageData, 0, 0);
  }

  updateFromImageData(image_data) {
    this.#imageData.data.set(image_data);
    this.#ctx.putImageData(this.#imageData, 0, 0);
  }

  setPixel(x, y, rgb) {
    const index = 4 * (x + this.width * y);
    this.#imageData.data[index] = rgb[0];
    this.#imageData.data[index + 1] = rgb[1];
    this.#imageData.data[index + 2] = rgb[2];
    this.#imageData.data[index + 3] = 255;
  }

  colorMap(value) {
    if (value === max_iterations) {
      return [0, 0, 0];
    }
    var rgb = (value * 0xffff / max) * 0xff;
    var red = rgb & 0xff;
    var green = (rgb >> 8) & 0xff;
    var blue = (rgb >> 16) & 0xff;

    return [red, green, blue];
  }

  mapColorAndSetPixel(x, y, value) {
    var rgb, r, g, b;
    var index = 4 * (x + this.width * y);
    if (value === max_iterations) {
      r = 0;
      g = 0;
      b = 0;
    }
    else {
      rgb = (value * 0xffff / max_iterations) * 0xff;
      r = rgb & 0xff;
      g = (rgb >> 8) & 0xff;
      b = (rgb >> 16) & 0xff;
    }
    this.#imageData.data[index] = r;
    this.#imageData.data[index + 1] = g;
    this.#imageData.data[index + 2] = b;
    this.#imageData.data[index + 3] = 255;
  }
};

class MandelbrotWorker extends Worker {
  constructor(handler, bufferSize) {
    super("mandelbrot-worker-asm.js");
    this.handler = handler;
    this.buffer = new ArrayBuffer(bufferSize);
  }
};

const mandelbrotWorkers = new class {
  #workers = [];

  addWorker(handler, bufferSize) {
    const worker = new MandelbrotWorker(handler, bufferSize);
    this.#workers.push(worker);

    worker.addEventListener('message', handler, false);

    return this.#workers.length - 1;
  }

  sendRequest(index, message) {
    const worker = this.#workers[index];
    const buffer = this.#workers[index].buffer;

    worker.postMessage ({ message, worker_index: index, buffer }, [buffer]);
  }

  restoreBuffer(index, buffer) {
    this.#workers[index].buffer = buffer;
  }

  terminateLastWorker() {
    const lastWorker = this.#workers.pop();
    lastWorker?.postMessage({ terminate: true });
  }

  terminateAllWorkers() {
    while (this.#workers.length) {
      this.terminateLastWorker();
    }
  }

  workerCount() {
    return this.#workers.length;
  }

  bufferOf(index) {
    return this.#workers[index]?.buffer;
  }

  workerIsActive(index) {
    return index < this.#workers.length;
  }
};

class Animator {
  scale_start = 1.0;
  scale_end   = 0.0005;
  xc_start    = -0.5;
  yc_start    = 0.0;
  xc_end      = 0.0;
  yc_end      = 0.75;
  steps       = 200.0;

  frame_count   = 0;  // number of frames painted to the canvas
  request_count = 0;  // number of frames requested from workers
  pending_frames = [];

  constructor(canvas) {
    this.canvas = canvas;
    this.bufferSize = canvas.width * canvas.height * 4;

    this.scale_step  = (this.scale_end - this.scale_start) / this.steps;
    this.xc_step     = (this.xc_end - this.xc_start) / this.steps;
    this.yc_step     = (this.yc_end - this.yc_start) / this.steps;
    this.scale       = this.scale_start;
    this.xc          = this.xc_start;
    this.yc          = this.yc_start;
  }

  // Look for a frame with 'frame_index' in the pending frames
  findFrame(frame_index) {
    for (var i = 0, n = this.pending_frames.length; i < n; ++i) {
      if (this.pending_frames[i].frame_index === frame_index) {
        return i;
      }
    }
    return false;
  }

  advanceFrame() {
    if (this.scale < this.scale_end || this.scale > this.scale_start) {
      this.scale_step = -this.scale_step;
      this.xc_step = -this.xc_step;
      this.yc_step = -this.yc_step;
    }
    this.scale += this.scale_step;
    this.xc += this.xc_step;
    this.yc += this.yc_step;
  }

  // Send a request to a worker to compute a frame
  requestFrame(worker_index) {
    mandelbrotWorkers.sendRequest(worker_index, { 
      request_count:  this.request_count,
      width:          this.canvas.width,
      height:         this.canvas.height,
      xc:             this.xc,
      yc:             this.yc,
      scale:          this.scale,
      max_iterations: max_iterations
    });
    this.request_count++;
    this.advanceFrame();
  }

  paintFrame(buffer) {
    this.canvas.updateFromImageData(buffer);
  }

  workerCount() {
    return mandelbrotWorkers.workerCount();
  }

  setWorkerCount(count) {
    while (mandelbrotWorkers.workerCount() < count) {
      this.addWorker();
    }

    while (mandelbrotWorkers.workerCount() > count) {
      this.removeWorker();
    }
  }

  addWorker() {
    // Called when a worker has computed a frame
    const updateFrame = e => {
      const worker_index  = e.data.worker_index;
      const request_count = e.data.message.request_count;

      // If not terminated in the meanwhile.
      if (worker_index < mandelbrotWorkers.workerCount()) {
        mandelbrotWorkers.restoreBuffer(worker_index, e.data.buffer);
      }

      if (request_count !== this.frame_count) {
        // frame came early, save it for later and do nothing now
        this.pending_frames.push({worker_index: worker_index, frame_index: request_count});
        return;
      }

      var buffer = new Uint8ClampedArray(e.data.buffer);
      this.paintFrame(buffer);
      this.frame_count++

      if (this.pending_frames.length > 0) {
        // there are delayed frames queued up.  Process them
        let frame;
        while ((frame = this.findFrame(this.frame_count)) !== false) {
          var windex = this.pending_frames[frame].worker_index;
          this.pending_frames.splice(frame, 1); // remove the frame from the pending_frames
          var buffer = mandelbrotWorkers.bufferOf(windex);
          this.paintFrame(new Uint8ClampedArray(buffer));
          this.frame_count++;
          if (mandelbrotWorkers.workerIsActive(windex)) {
            this.requestFrame(windex);
            this.advanceFrame();
          }
        }
      }

      if (mandelbrotWorkers.workerIsActive(e.data.worker_index)) {
        this.requestFrame(e.data.worker_index);
        this.advanceFrame();
      }
    }

    const workerIndex = mandelbrotWorkers.addWorker(updateFrame, this.bufferSize);
    this.requestFrame(workerIndex);
    this.advanceFrame();
  }

  removeWorker() {
    mandelbrotWorkers.terminateLastWorker();
  }
}

worker_count = 0;
const canvas = new Mandelbrot("mandel");
const animator = new Animator(canvas);
canvas.clear();
canvas.update();

$("start").onclick = () => animator.setWorkerCount(1);
$("stop").onclick = () => animator.setWorkerCount(0);
$("ww_add").onclick = () => animator.addWorker();
$("ww_sub").onclick = () => animator.removeWorker();

const setWorkerCount = count => animator.setWorkerCount(count);
const workerCount = () => animator.workerCount();