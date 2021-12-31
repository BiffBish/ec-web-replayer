const WEBGL = require("../lib/WebGL");
const Viewer = require("./viewer");
const Playback = require("./playback_controls");
const queryString = require("query-string");
const parsePath = require("parse-path");

const ecRankedApi = "https://ecranked.ddns.net/api/v1/replay/";

if (!(window.File && window.FileReader && window.FileList && window.Blob)) {
  console.error("The File APIs are not fully supported in this browser.");
} else if (!WEBGL.isWebGLAvailable()) {
  console.error("WebGL is not supported in this browser.");
}

let playback = null; //playback object that handles everything

class App {
  /**
   * @param  {Element} el
   * @param  {Location} location
   */
  constructor(el, location) {
    const hash = location.hash ? queryString.parse(location.hash) : {};
    this.el = el;
    this.viewer = null;
    this.viewerEl = null;
    this.spinnerEl = el.querySelector(".spinner");
    this.dropEl = el.querySelector(".dropzone");
    this.dropLabel = el.querySelector(".placeholder");
    this.uploadForm = el.querySelector(".upload-btn");
    this.inputEl = el.querySelector("#file-input");
    this.exitReplayEl = el.querySelector("#exit-replay");
    this.options = {
      url: hash.url || "",
      replay: hash.replay || "",
      model: hash.model || "",
      preset: hash.preset || "",
      cameraPosition: hash.cameraPosition
        ? hash.cameraPosition.split(",").map(Number)
        : null,
      spinner: this.spinnerEl,
    };

    const options = this.options;
    //console.log("Got options: " + JSON.stringify(options));

    if (options.model) {
      this.view(options.model, "", new Map());
      this.hideSpinner();
    } else if (options.replay) {
      this.exitReplayEl.href = "https://ecranked.com/replay/" + options.replay;

      // TODO Use async / await.
      const myPromise = new Promise((resolve, reject) => {
        setTimeout(() => {
          const f = this.loadUrl(options.replay);
          resolve(f);
        }, 300);
      });
      myPromise.then(
        (data) => {
          this.view(data, "", "");
        },
        (error) => {
          this.onError("Could not fetch replay from server!");
        }
      );
    } else {
      this.hideSpinner();
    }
  }

  /**
   * Sets up the view manager.
   * @return {Viewer}
   */
  createViewer() {
    this.viewerEl = document.createElement("div");
    this.viewerEl.classList.add("viewer");
    this.dropEl.innerHTML = "";
    this.dropEl.appendChild(this.viewerEl);
    playback = new Playback(document);
    this.viewer = new Viewer(this.viewerEl, playback, this.options);
    return this.viewer;
  }

  /**
   * Loads a fileset provided by user action.
   * @param  {Map<string, File>} fileMap
   */
  load(fileMap) {
    let rootFile;
    let rootPath;
    Array.from(fileMap).forEach(([path, file]) => {
      if (file.name.match(/\.(echoreplay)$/)) {
        rootFile = file;
        rootPath = path.replace(file.name, "");
      }
    });

    if (!rootFile) {
      this.onError("No .echoreplay asset found.");
    }

    this.view(rootFile, rootPath, fileMap);
  }

  async loadUrl(replayUuid) {
    let infoResponse = await fetch(ecRankedApi + replayUuid);
    let replayInfo = await infoResponse.json();

    let dataResponse = await fetch(ecRankedApi + replayUuid + "/download");
    let data = await dataResponse.blob();
    let metadata = {
      type: "application/zip",
    };
    return {
      info: replayInfo,
      file: new File([data], replayUuid + ".echoreplay", metadata),
    };
  }

  /**
   * Passes an .echoreplay file to the viewer, given file and resources.
   * @param  {File|string} rootFile
   * @param  {string} rootPath
   * @param  {Map<string, File>} fileMap
   */
  view(replaydata, rootPath, fileMap) {
    if (this.viewer) this.viewer.clear();
    const rootFile = replaydata.file;
    const rootInfo = replaydata.info;
    const viewer = this.viewer || this.createViewer();
    console.log(
      "rootFile: " + rootFile + " rootPath: " + rootPath + ", " + fileMap
    );
    const fileURL =
      typeof rootFile === "string" ? rootFile : URL.createObjectURL(rootFile);
    this.showSpinner();

    viewer
      .load(fileURL, rootInfo, rootFile, rootPath, fileMap)
      .catch((e) => this.onError(e))
      .then(() => {
        if (typeof rootFile === "object") URL.revokeObjectURL(fileURL);
      });
  }

  /**
   * @param  {Error} error
   */
  onError(error) {
    let message = (error || {}).message || error.toString();
    if (message.match(/ProgressEvent/)) {
      message =
        "Unable to retrieve this file. Check JS console and browser network tab.";
    } else if (message.match(/Unexpected token/)) {
      message = `Unable to parse file content. Verify that this file is valid. Error: "${message}"`;
    } else if (error && error.target && error.target instanceof Image) {
      message = "Missing texture: " + error.target.src.split("/").pop();
    }
    window.alert(message);
    console.error(error);
  }

  showSpinner() {
    this.spinnerEl.style.display = "";
  }

  hideSpinner() {
    this.spinnerEl.style.display = "none";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const app = new App(document.body, location);

  // Spacebar toggles playback
  document.body.onkeyup = function (e) {
    if (e.keyCode === 32 || e.key === " " || e.key === "Spacebar") {
      playback.toggle();
    }
  };
});
