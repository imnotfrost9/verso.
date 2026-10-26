(function () {
  const State = { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
  class FakePlayer {
    constructor(id, options) {
      this.options = options;
      this.videoId = options.videoId;
      this.duration = 9;
      this.time = 0;
      this.state = -1;
      window.fakePlayer = this;
      setTimeout(() => { options.events.onReady({ target: this }); this.setState(State.CUED); }, 30);
    }
    setState(value) { this.state = value; if (this.options.events.onStateChange) this.options.events.onStateChange({ data: value, target: this }); }
    getCurrentTime() { if (this.state === State.PLAYING) this.time = Math.min(this.duration, this.time + 0.05); return this.time; }
    getDuration() { return this.duration; }
    seekTo(value) { this.time = value; }
    playVideo() { this.setState(State.PLAYING); }
    pauseVideo() { if (this.state !== State.PAUSED) this.setState(State.PAUSED); }
    loadVideoById(id) { this.videoId = id; this.time = 0; this.setState(State.PLAYING); }
  }
  window.YT = { Player: FakePlayer, PlayerState: State };
})();
