let musicContainer = null;
let playBtn = null;
let prevBtn = null;
let nextBtn = null;

let progress = null;
let buffer = null;

let progressContainer = null;
let title = null;
let percent = null;
let mouseDown = false;

// Song titles
const songs = ["dream", "melody", "peace"];

// Keep track of song
let songIndex = 1;

let viewer = null;

module.exports = class Playback {
  constructor(body) {
    musicContainer = body.getElementById("audio-container");
    playBtn = body.getElementById("play");
    prevBtn = body.getElementById("prev");
    nextBtn = body.getElementById("next");
    progress = body.getElementById("progress");
    buffer = body.getElementById("buffer");

    progressContainer = body.getElementById("progress-container");
    title = body.getElementById("title");
    percent = body.getElementById("percent");

    // Event listeners
    playBtn.addEventListener("click", () => {
      this.toggle();
    });

    // Change song
    prevBtn.addEventListener("click", this.prevSong);
    nextBtn.addEventListener("click", this.nextSong);

    // Click on progress bar
    progressContainer.addEventListener("mousemove", (e) => {
      if (mouseDown) {
        this.setProgress(e);
      }
    });
    progressContainer.addEventListener("mousedown", (e) => {
      this.setProgress(e);

      mouseDown = true;
    });
    progressContainer.addEventListener("click", (e) => {
      this.setProgress(e);
    });
    progressContainer.addEventListener("mouseleave", function (e) {
      mouseDown = false;
    });
    progressContainer.addEventListener("mouseup", function (e) {
      mouseDown = false;
    });

    console.log("Called Playback constructor");
  }

  setViewer(_viewer) {
    viewer = _viewer;
    console.log("called setviewer");
  }

  // Update song details
  loadSong(mapName, timestamp) {
    title.innerText = mapName + ": " + timestamp;
    musicContainer.classList.remove("hide");
    console.log("Loaded map into playback controls: " + mapName);
  }

  updateTitle(text) {
    title.innerText = text;
  }

  updatePercent(text) {
    percent.innerText = text;
  }

  // Play song
  playSong() {
    musicContainer.classList.add("play");
    playBtn.querySelector("i.fas").classList.remove("fa-play");
    playBtn.querySelector("i.fas").classList.add("fa-pause");

    viewer.play();
  }

  // Pause song
  pauseSong() {
    musicContainer.classList.remove("play");
    playBtn.querySelector("i.fas").classList.add("fa-play");
    playBtn.querySelector("i.fas").classList.remove("fa-pause");

    viewer.pause();
  }

  toggle() {
    const isPlaying = musicContainer.classList.contains("play");
    if (isPlaying) {
      this.pauseSong();
    } else {
      this.playSong();
    }
  }

  isPaused() {
    return !musicContainer.classList.contains("play");
  }

  // Previous song
  prevSong() {
    viewer.stepBackward();
  }

  // Next song
  nextSong() {
    viewer.stepForward();
  }

  // Update progress bar
  updateProgress(currentTime, duration) {
    const progressPercent = (currentTime / duration) * 100;
    progress.style.width = `${progressPercent}%`;
    // console.log(
    //   "Upate progress: duration: " + duration + ", currentTime: " + currentTime,
    //   ", Progresspercent: " + progressPercent
    // );
  }

  updateBuffer(currentTime, duration) {
    const bufferPercent = (currentTime / duration) * 100;
    buffer.style.width = `${bufferPercent}%`;
    // console.log(
    //   "Upate progress: duration: " + duration + ", currentTime: " + currentTime,
    //   ", Progresspercent: " + progressPercent
    // );
  }
  // Set progress bar
  setProgress(e) {
    console.log(e);
    const width = progressContainer.clientWidth;
    const clickX = e.offsetX;
    console.log(
      "OffsetX: " + clickX + " width: " + width + ", progress: " + clickX
    );
    progress.style.width = `${clickX}px`;
    viewer.setProgress(clickX / width);
  }
};
