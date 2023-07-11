export function toBinaryString(value) {
  let str = (value >>> 0).toString(2);
  return str.padStart(Math.ceil(str.length / 8) * 8, '0');
}

function reverseByte(b) {
  b = (b & 0b11110000) >> 4 | (b & 0b00001111) << 4;
  b = (b & 0b11001100) >> 2 | (b & 0b00110011) << 2;
  b = (b & 0b10101010) >> 1 | (b & 0b01010101) << 1;
  return b;
}

export class ByteView {
  constructor(buf) {
    this.buffer = buf;
    this.u8 = new Uint8Array(buf);
    this.length = 0;
  }

  getBit(index) {
    const v = this.u8[index >> 3];
    const offset = index & 0x7;
    return (v >> (7-offset)) & 1;
  };

  setBit(index, value) {
    this.length = Math.max(this.length, index + 1);
    const offset = index & 0x7;
    if (value) {
      this.u8[index >> 3] |= (0x80 >> offset);
    } else {
      this.u8[index >> 3] &= ~(0x80 >> offset);
    }
  };

  getByte(index) {
    return this.u8[index];
  }

  setByte(index, value) {
    this.u8[index] = value;
  }

  validate() {
    const complement = new Uint8Array([reverseByte(~this.u8[1])])[0]; // we need it unsigned
    return complement == this.u8[0];
  }

  clear() {
    this.length = 0;
    this.u8.fill(0);
  }

  shift16Left(amount, index = 0) {
    let view = new DataView(this.buffer);
    let value = view.getUint16(index, false);
    view.setInt16(index, value << amount, false);
  }

  toString() {
    const res = [];
    let i = 0
    for (; i < this.u8.length; i++) {
      res.push(toBinaryString(this.u8[i]))
    }
    return res.join(" ");
  }

  [Symbol.iterator]() {
    return {
      current: 0,
      last: this.buffer.length * 8,
      view: this,

      next() {
        if (this.current <= this.last) {
          return { done: false, value: this.view.getBit(this.current++) };
        } else {
          return { done: true };
        }
      }
    };
  }
}

export class MessageEncoder {
  encode(message) {
    const enc = new TextEncoder("utf-8");

    // We send 32 bits per ASCII character:
    //   |position| with the first bit set to 1 indicating a position
    //   |checksum| and alignment byte for the position
    //   |value| Non extended ASCII character
    //   |checksum| and alignment byte for the value
    //
    // A checksum is the reversed complement, e.g for 0110 1000
    // the complement will be 10010111 and reversed it will be 11101001
    const letters = [...enc.encode(message)].flatMap((value, position) => {
      const pos = position | 0b10000000;
      const vPos = reverseByte(~pos);
      const vValue = reverseByte(~value);
      return [ pos, vPos, value, vValue ]
    });

    return new Uint8Array([...letters]);
  }
}