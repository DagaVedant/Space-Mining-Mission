export class SplitMix64 {
  private state: bigint;

  constructor(seed: number) {
    this.state = BigInt(seed >>> 0);
  }

  nextUint32(): number {
    this.state = (this.state + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn;
    z ^= z >> 31n;
    return Number(z & 0xffffffffn);
  }

  integer(maxExclusive: number): number {
    if (maxExclusive <= 0) {
      return 0;
    }
    return this.nextUint32() % maxExclusive;
  }
}
