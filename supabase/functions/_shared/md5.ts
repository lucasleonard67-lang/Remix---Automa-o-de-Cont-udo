// _shared/md5.ts — MD5 incremental com estado que cabe no banco.
//
// O Drive devolve `md5Checksum`, mas a edge não pode carregar um vídeo inteiro nem
// gastar mais de 2 s de CPU por execução. O hash anda por blocos e PARA entre uma
// execução e outra: `snapshot()` vira JSON numa coluna e `Md5.from()` continua de
// onde parou. Por isso não dá para usar o MD5 do runtime, que não exporta estado.
//
// MD5 aqui é conferência de integridade contra o que o Drive informa, não segurança.

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const K = new Int32Array(64);
for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0;

export interface Md5State {
  /** a, b, c, d como inteiros de 32 bits */
  h: [number, number, number, number];
  /** bytes já consumidos */
  length: number;
  /** resto do bloco incompleto, em base64 */
  tail: string;
}

const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export class Md5 {
  private a = 0x67452301 | 0;
  private b = 0xefcdab89 | 0;
  private c = 0x98badcfe | 0;
  private d = 0x10325476 | 0;
  private readonly tail = new Uint8Array(64);
  private tailLength = 0;
  private total = 0;
  private readonly x = new Int32Array(16);

  static from(state: Md5State | null | undefined): Md5 {
    const md5 = new Md5();
    if (!state) return md5;
    [md5.a, md5.b, md5.c, md5.d] = state.h;
    md5.total = state.length;
    const tail = fromBase64(state.tail);
    md5.tail.set(tail);
    md5.tailLength = tail.length;
    return md5;
  }

  /** Bytes consumidos até aqui. */
  get length(): number {
    return this.total;
  }

  snapshot(): Md5State {
    return {
      h: [this.a, this.b, this.c, this.d],
      length: this.total,
      tail: toBase64(this.tail.subarray(0, this.tailLength)),
    };
  }

  update(bytes: Uint8Array): this {
    this.total += bytes.length;
    let offset = 0;
    if (this.tailLength) {
      const take = Math.min(64 - this.tailLength, bytes.length);
      this.tail.set(bytes.subarray(0, take), this.tailLength);
      this.tailLength += take;
      offset = take;
      if (this.tailLength < 64) return this;
      this.block(this.tail, 0);
      this.tailLength = 0;
    }
    for (; offset + 64 <= bytes.length; offset += 64) this.block(bytes, offset);
    if (offset < bytes.length) {
      this.tail.set(bytes.subarray(offset));
      this.tailLength = bytes.length - offset;
    }
    return this;
  }

  /** Hex do hash. Não altera o estado: dá para continuar depois. */
  digest(): string {
    const copy = Md5.from(this.snapshot());
    const bits = this.total * 8;
    const pad = new Uint8Array((this.tailLength < 56 ? 56 : 120) - this.tailLength + 8);
    pad[0] = 0x80;
    const view = new DataView(pad.buffer);
    view.setUint32(pad.length - 8, bits % 2 ** 32, true);
    view.setUint32(pad.length - 4, Math.floor(bits / 2 ** 32), true);
    copy.update(pad);
    const out = new DataView(new ArrayBuffer(16));
    [copy.a, copy.b, copy.c, copy.d].forEach((word, i) => out.setInt32(i * 4, word, true));
    return Array.from(new Uint8Array(out.buffer), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  private block(data: Uint8Array, at: number): void {
    const x = this.x;
    for (let i = 0; i < 16; i++) {
      const p = at + i * 4;
      x[i] = data[p] | (data[p + 1] << 8) | (data[p + 2] << 16) | (data[p + 3] << 24);
    }
    let a = this.a;
    let b = this.b;
    let c = this.c;
    let d = this.d;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) & 15;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) & 15;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) & 15;
      }
      const sum = (a + f + K[i] + x[g]) | 0;
      const s = S[i];
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << s) | (sum >>> (32 - s)))) | 0;
    }
    this.a = (this.a + a) | 0;
    this.b = (this.b + b) | 0;
    this.c = (this.c + c) | 0;
    this.d = (this.d + d) | 0;
  }
}
