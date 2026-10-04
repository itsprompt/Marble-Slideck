/* Marble Slideck keeps the presentation as plain data; the canvas is always rendered from this model. */
const SLIDE_WIDTH = 1280;
const SLIDE_HEIGHT = 720;
const STORAGE_KEY = "marble-slideck-deck-v1";
const makeId = () =>
  `obj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const makeSlide = () => ({ id: makeId(), background: "#ffffff", objects: [] });
const deck = { title: "Untitled Slideck", slides: [makeSlide()] };

let currentSlideId = deck.slides[0].id;
let selectedObjectId = null;
let historyPast = [];
let historyFuture = [];
let copiedObject = null;
let activeGesture = null;
let presentIndex = 0;
let saveTimer;
let openMenuId = null;

const $ = (selector) => document.querySelector(selector);
const slideList = $("#slides");
const canvas = $("#slide");
const propertiesContent = $("#properties-content");
const cloneData = (value) => JSON.parse(JSON.stringify(value));
const currentSlide = () =>
  deck.slides.find((slide) => slide.id === currentSlideId) || deck.slides[0];
const selectedObject = () =>
  currentSlide()?.objects.find((object) => object.id === selectedObjectId) ||
  null;
const snapshot = () =>
  JSON.stringify({ title: deck.title, slides: deck.slides, currentSlideId });

function markSaved() {
  clearTimeout(saveTimer);
  $("#save-label").textContent = "Saving…";
  $("#save-indicator").classList.add("unsaved");
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ title: deck.title, slides: deck.slides }),
      );
      $("#save-label").textContent = "Saved locally";
      $("#save-indicator").classList.remove("unsaved");
    } catch (error) {
      $("#save-label").textContent = "Autosave unavailable";
      console.warn("Slideck could not autosave this deck.", error);
    }
  }, 180);
}

function recordHistory(before) {
  if (!before || before === snapshot()) return;
  historyPast.push(before);
  if (historyPast.length > 100) historyPast.shift();
  historyFuture = [];
  updateHistoryButtons();
  markSaved();
}

function transact(change) {
  const before = snapshot();
  change();
  recordHistory(before);
  render();
}

function restoreSnapshot(serialized) {
  const restored = JSON.parse(serialized);
  deck.title = restored.title;
  deck.slides = restored.slides;
  currentSlideId = deck.slides.some(
    (slide) => slide.id === restored.currentSlideId,
  )
    ? restored.currentSlideId
    : deck.slides[0]?.id;
  selectedObjectId = null;
  render();
  markSaved();
}

function undo() {
  if (!historyPast.length) return;
  historyFuture.push(snapshot());
  restoreSnapshot(historyPast.pop());
  updateHistoryButtons();
}

function redo() {
  if (!historyFuture.length) return;
  historyPast.push(snapshot());
  restoreSnapshot(historyFuture.pop());
  updateHistoryButtons();
}

function updateHistoryButtons() {
  $("#undo").disabled = historyPast.length === 0;
  $("#redo").disabled = historyFuture.length === 0;
  updateMenuAvailability();
}

function updateMenuAvailability() {
  const availability = {
    "#menu-undo": historyPast.length > 0,
    "#menu-redo": historyFuture.length > 0,
    "#menu-copy": !!selectedObject(),
    "#menu-paste": !!copiedObject,
    "#menu-duplicate": !!selectedObject(),
    "#menu-delete": !!selectedObject(),
  };
  Object.entries(availability).forEach(([selector, enabled]) => {
    const item = $(selector);
    if (item) item.disabled = !enabled;
  });
  const slides = $(".slide-sidebar");
  const properties = $(".properties-panel");
  $("[data-command='toggle-slides']")?.setAttribute(
    "aria-checked",
    String(!slides.classList.contains("is-hidden")),
  );
  $("[data-command='toggle-properties']")?.setAttribute(
    "aria-checked",
    String(!properties.classList.contains("is-hidden")),
  );
}

function hideContextMenu() {
  const menu = $("#editor-context-menu");
  menu.hidden = true;
  menu.replaceChildren();
}

function showContextMenu(event, entries) {
  event.preventDefault();
  closeEditorMenu();
  const menu = $("#editor-context-menu");
  menu.replaceChildren();
  entries.forEach((entry) => {
    if (entry.separator) {
      menu.append(document.createElement("hr"));
      return;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.textContent = entry.label;
    button.disabled = !!entry.disabled;
    button.addEventListener("click", () => {
      hideContextMenu();
      entry.action();
    });
    menu.append(button);
  });
  menu.hidden = false;
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - bounds.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - bounds.height - 8))}px`;
  menu.querySelector("button:not(:disabled)")?.focus();
}

function showObjectContextMenu(event, object) {
  const objects = currentSlide().objects;
  const objectIndex = objects.findIndex((item) => item.id === object.id);
  showContextMenu(event, [
    { label: "Copy", action: copySelected },
    { label: "Paste", disabled: !copiedObject, action: pasteCopied },
    { label: "Duplicate", action: duplicateSelected },
    { separator: true },
    {
      label: "Bring forward",
      disabled: objectIndex >= objects.length - 1,
      action: () => changeLayer(1),
    },
    {
      label: "Send backward",
      disabled: objectIndex <= 0,
      action: () => changeLayer(-1),
    },
    {
      label: "Bring to front",
      disabled: objectIndex >= objects.length - 1,
      action: () => changeLayer("front"),
    },
    {
      label: "Send to back",
      disabled: objectIndex <= 0,
      action: () => changeLayer("back"),
    },
    { separator: true },
    { label: "Delete", action: deleteSelected },
  ]);
}

function showCanvasContextMenu(event) {
  const objectElement = event.target.closest("[data-object-id]");
  if (objectElement) {
    selectedObjectId = objectElement.dataset.objectId;
    const object = selectedObject();
    renderCanvas();
    renderInspector();
    showObjectContextMenu(event, object);
    return;
  }
  selectedObjectId = null;
  renderCanvas();
  renderInspector();
  showContextMenu(event, [
    { label: "Paste", disabled: !copiedObject, action: pasteCopied },
    { separator: true },
    { label: "Insert text", action: () => insertObject("text") },
    { label: "Insert rectangle", action: () => insertObject("shape") },
    {
      label: "Insert circle",
      action: () => insertObject("circle", { width: 190, height: 190 }),
    },
    { label: "Insert image…", action: () => $("#image-input").click() },
    { separator: true },
    {
      label: "Slide background…",
      action: () => $("#background-color").click(),
    },
  ]);
}

function openEditorMenu(trigger, focusFirst = false) {
  closeEditorMenu();
  const menuId = trigger.dataset.menuTrigger;
  const menu = $(`#${menuId}-menu`);
  if (!menu) return;
  openMenuId = menuId;
  trigger.setAttribute("aria-expanded", "true");
  menu.hidden = false;
  if (focusFirst)
    menu.querySelector('[role^="menuitem"]:not(:disabled)')?.focus();
}

function closeEditorMenu(returnFocus = false) {
  if (!openMenuId) return;
  const trigger = $(`[data-menu-trigger="${openMenuId}"]`);
  const menu = $(`#${openMenuId}-menu`);
  if (trigger) trigger.setAttribute("aria-expanded", "false");
  if (menu) menu.hidden = true;
  openMenuId = null;
  if (returnFocus) trigger?.focus();
}

function toggleEditorMenu(trigger) {
  if (openMenuId === trigger.dataset.menuTrigger) closeEditorMenu();
  else openEditorMenu(trigger);
}

function copySelected() {
  if (!selectedObject()) return;
  copiedObject = cloneData(selectedObject());
  updateMenuAvailability();
}

function pasteCopied() {
  if (!copiedObject) return;
  const copy = cloneData(copiedObject);
  copy.id = makeId();
  copy.x = Math.min(SLIDE_WIDTH - copy.width, copy.x + 24);
  copy.y = Math.min(SLIDE_HEIGHT - copy.height, copy.y + 24);
  transact(() => {
    currentSlide().objects.push(copy);
    selectedObjectId = copy.id;
  });
  copiedObject = cloneData(copy);
}

function runMenuCommand(command) {
  switch (command) {
    case "new-deck":
      newDeck();
      break;
    case "open":
      $("#file-input").click();
      break;
    case "save":
      downloadDeck();
      break;
    case "new-slide":
      addSlide();
      break;
    case "undo":
      undo();
      break;
    case "redo":
      redo();
      break;
    case "copy":
      copySelected();
      break;
    case "paste":
      pasteCopied();
      break;
    case "duplicate":
      duplicateSelected();
      break;
    case "delete":
      deleteSelected();
      break;
    case "toggle-slides":
      $(".slide-sidebar").classList.toggle("is-hidden");
      updateMenuAvailability();
      break;
    case "toggle-properties":
      $(".properties-panel").classList.toggle("is-hidden");
      updateMenuAvailability();
      break;
    case "present":
      startPresentation();
      break;
    case "insert-text":
      $("#insert-text").click();
      break;
    case "insert-rect":
      $("#insert-rect").click();
      break;
    case "insert-round":
      $("#insert-round").click();
      break;
    case "insert-circle":
      $("#insert-circle").click();
      break;
    case "insert-line":
      $("#insert-line").click();
      break;
    case "insert-image":
      $("#insert-image").click();
      break;
  }
}

function render() {
  if (!deck.slides.length) deck.slides.push(makeSlide());
  if (!deck.slides.some((slide) => slide.id === currentSlideId))
    currentSlideId = deck.slides[0].id;
  $("#deck-title").value = deck.title;
  renderSlideList();
  renderCanvas();
  renderInspector();
  updateHistoryButtons();
  markSaved();
}

function objectCss(object) {
  return {
    left: `${(object.x / SLIDE_WIDTH) * 100}%`,
    top: `${(object.y / SLIDE_HEIGHT) * 100}%`,
    width: `${(object.width / SLIDE_WIDTH) * 100}%`,
    height: `${(object.height / SLIDE_HEIGHT) * 100}%`,
  };
}

function createObjectElement(object, interactive = true) {
  let element;
  if (object.type === "image") {
    element = document.createElement("img");
    element.src = object.src;
    element.alt = object.alt || "Slide image";
    element.draggable = false;
    element.className = "slide-object image-object";
  } else if (object.type === "text") {
    element = document.createElement("div");
    element.className = "slide-object text-object";
    element.textContent = object.text;
    element.style.fontFamily = object.fontFamily;
    element.style.fontSize = `${object.fontSize}px`;
    element.style.fontWeight = object.bold ? "700" : "400";
    element.style.fontStyle = object.italic ? "italic" : "normal";
    element.style.textDecoration = object.underline ? "underline" : "none";
    element.style.color = object.color;
    element.style.textAlign = object.align;
  } else {
    element = document.createElement("div");
    element.className = "slide-object shape-object";
    element.style.background =
      object.type === "line" ? "transparent" : object.fill || "#dceae2";
    element.style.borderColor = object.border || "#28785e";
    element.style.borderWidth = `${object.borderWidth ?? 2}px`;
    element.style.borderRadius =
      object.type === "round"
        ? `${object.radius || 18}px`
        : object.type === "circle"
          ? "50%"
          : "0";
    if (object.type === "line") {
      element.style.borderWidth = "0";
      element.style.background = object.border || "#28785e";
      element.style.height = `${Math.max(2, object.borderWidth || 3)}px`;
      element.style.transform = `rotate(${object.angle || 0}deg)`;
      element.style.transformOrigin = "left center";
    }
  }
  element.dataset.objectId = object.id;
  Object.assign(element.style, objectCss(object));
  if (selectedObjectId === object.id && interactive) {
    element.classList.add("selected");
    for (const handleName of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
      const handle = document.createElement("span");
      handle.className = `resize-handle ${handleName}`;
      handle.dataset.handle = handleName;
      element.append(handle);
    }
  }
  if (interactive) {
    element.addEventListener("pointerdown", (event) =>
      beginObjectPointer(event, object),
    );
    element.addEventListener("dblclick", (event) => {
      if (object.type === "text") beginTextEditing(event.currentTarget, object);
    });
  }
  return element;
}

function renderCanvas() {
  const slide = currentSlide();
  canvas.replaceChildren();
  canvas.style.background = slide.background || "#ffffff";
  slide.objects.forEach((object) => canvas.append(createObjectElement(object)));
  $("#canvas-label").textContent = `Slide ${deck.slides.indexOf(slide) + 1}`;
  $("#selection-status").textContent = selectedObject()
    ? `${selectedObject().type} selected`
    : "No selection";
  $("#background-color").value = slide.background || "#ffffff";
  $("#object-actions").hidden = !selectedObject();
  const textToolbar = $("#text-toolbar");
  textToolbar.hidden = selectedObject()?.type !== "text";
  canvas.parentElement.classList.toggle("has-format", !textToolbar.hidden);
  updateMenuAvailability();
}

function renderSlideList() {
  slideList.replaceChildren();
  deck.slides.forEach((slide, index) => {
    const item = document.createElement("div");
    item.className = `slide-item${slide.id === currentSlideId ? " selected" : ""}`;
    item.draggable = true;
    item.dataset.slideId = slide.id;
    const number = document.createElement("span");
    number.className = "slide-number";
    number.textContent = String(index + 1).padStart(2, "0");
    const frame = document.createElement("div");
    frame.className = "slide-thumb-frame";
    frame.addEventListener("click", () => selectSlide(slide.id));
    const thumb = document.createElement("div");
    thumb.className = "slide-thumb";
    thumb.style.background = slide.background || "#fff";
    slide.objects.forEach((object) => {
      const preview = document.createElement(
        object.type === "image" ? "img" : "div",
      );
      preview.className = "slide-thumb-object";
      Object.assign(preview.style, objectCss(object));
      if (object.type === "text") {
        preview.textContent = object.text;
        preview.style.font = `${object.bold ? "700" : "400"} ${Math.max(6, object.fontSize * 0.14)}px ${object.fontFamily}`;
        preview.style.color = object.color;
        preview.style.textAlign = object.align;
        preview.style.textDecoration = object.underline ? "underline" : "none";
        preview.style.lineHeight = "1.15";
      } else if (object.type === "image") {
        preview.src = object.src;
      } else {
        preview.style.background =
          object.type === "line" ? object.border : object.fill || "#dceae2";
        preview.style.border =
          object.type === "line"
            ? "0"
            : `${Math.max(0.5, (object.borderWidth || 2) * 0.12)}px solid ${object.border || "#28785e"}`;
        preview.style.borderRadius =
          object.type === "circle"
            ? "50%"
            : object.type === "round"
              ? "4px"
              : "0";
      }
      thumb.append(preview);
    });
    frame.append(thumb);
    const actions = document.createElement("div");
    actions.className = "slide-item-actions";
    const duplicate = document.createElement("button");
    duplicate.textContent = "▢";
    duplicate.title = "Duplicate slide";
    duplicate.addEventListener("click", (event) => {
      event.stopPropagation();
      duplicateSlide(slide.id);
    });
    const remove = document.createElement("button");
    remove.textContent = "×";
    remove.title = "Delete slide";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteSlide(slide.id);
    });
    actions.append(duplicate, remove);
    item.append(number, frame, actions);
    item.addEventListener("click", () => selectSlide(slide.id));
    item.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      currentSlideId = slide.id;
      selectedObjectId = null;
      render();
      showContextMenu(event, [
        { label: "Duplicate slide", action: () => duplicateSlide(slide.id) },
        { label: "Delete slide", action: () => deleteSlide(slide.id) },
      ]);
    });
    item.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/plain", slide.id);
      item.classList.add("dragging");
    });
    item.addEventListener("dragend", () => item.classList.remove("dragging"));
    item.addEventListener("dragover", (event) => event.preventDefault());
    item.addEventListener("drop", (event) => {
      event.preventDefault();
      reorderSlide(event.dataTransfer.getData("text/plain"), slide.id);
    });
    slideList.append(item);
  });
  $("#slide-count").textContent = String(deck.slides.length).padStart(2, "0");
}

function selectSlide(id) {
  currentSlideId = id;
  selectedObjectId = null;
  render();
}

function addSlide() {
  transact(() => {
    const slide = makeSlide();
    const index = deck.slides.findIndex((item) => item.id === currentSlideId);
    deck.slides.splice(index + 1, 0, slide);
    currentSlideId = slide.id;
    selectedObjectId = null;
  });
}

function deleteSlide(id) {
  if (deck.slides.length === 1) {
    transact(() => {
      deck.slides[0] = makeSlide();
      currentSlideId = deck.slides[0].id;
      selectedObjectId = null;
    });
    return;
  }
  transact(() => {
    const index = deck.slides.findIndex((slide) => slide.id === id);
    deck.slides = deck.slides.filter((slide) => slide.id !== id);
    if (currentSlideId === id)
      currentSlideId = deck.slides[Math.max(0, index - 1)].id;
    selectedObjectId = null;
  });
}

function duplicateSlide(id) {
  transact(() => {
    const index = deck.slides.findIndex((slide) => slide.id === id);
    const copy = cloneData(deck.slides[index]);
    copy.id = makeId();
    copy.objects.forEach((object) => {
      object.id = makeId();
    });
    deck.slides.splice(index + 1, 0, copy);
    currentSlideId = copy.id;
    selectedObjectId = null;
  });
}

function reorderSlide(sourceId, targetId) {
  if (!sourceId || sourceId === targetId) return;
  transact(() => {
    const sourceIndex = deck.slides.findIndex((slide) => slide.id === sourceId);
    const targetIndex = deck.slides.findIndex((slide) => slide.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [slide] = deck.slides.splice(sourceIndex, 1);
    deck.slides.splice(targetIndex, 0, slide);
  });
}

function insertObject(type, extra = {}) {
  const defaults = {
    id: makeId(),
    type,
    x: 300,
    y: 230,
    width: type === "text" ? 520 : 250,
    height: type === "text" ? 120 : 170,
  };
  let object;
  if (type === "text")
    object = {
      ...defaults,
      text: "Double-click to edit",
      fontFamily: "Arial",
      fontSize: 36,
      bold: false,
      italic: false,
      underline: false,
      color: "#252b2c",
      align: "left",
    };
  else
    object = {
      ...defaults,
      fill: "#dceae2",
      border: "#28785e",
      borderWidth: type === "line" ? 4 : 2,
      radius: 18,
      ...extra,
    };
  transact(() => {
    currentSlide().objects.push(object);
    selectedObjectId = object.id;
  });
}

function deleteSelected() {
  if (!selectedObject()) return;
  transact(() => {
    currentSlide().objects = currentSlide().objects.filter(
      (object) => object.id !== selectedObjectId,
    );
    selectedObjectId = null;
  });
}

function duplicateSelected() {
  const source = selectedObject();
  if (!source) return;
  transact(() => {
    const copy = cloneData(source);
    copy.id = makeId();
    copy.x = Math.min(SLIDE_WIDTH - 30, copy.x + 28);
    copy.y = Math.min(SLIDE_HEIGHT - 30, copy.y + 24);
    currentSlide().objects.push(copy);
    selectedObjectId = copy.id;
  });
}

function changeLayer(direction) {
  const objects = currentSlide().objects;
  const index = objects.findIndex((object) => object.id === selectedObjectId);
  const target =
    direction === "front"
      ? objects.length - 1
      : direction === "back"
        ? 0
        : index + direction;
  if (index < 0 || target < 0 || target >= objects.length || target === index)
    return;
  transact(() => {
    const [object] = objects.splice(index, 1);
    objects.splice(target, 0, object);
  });
}

function beginObjectPointer(event, object) {
  if (event.button !== 0 || event.target.isContentEditable) return;
  event.preventDefault();
  event.stopPropagation();
  if (selectedObjectId !== object.id) {
    selectedObjectId = object.id;
    render();
    return;
  }
  const handle = event.target.dataset.handle;
  activeGesture = {
    before: snapshot(),
    object,
    handle,
    startX: event.clientX,
    startY: event.clientY,
    x: object.x,
    y: object.y,
    width: object.width,
    height: object.height,
    scaleX: canvas.getBoundingClientRect().width / SLIDE_WIDTH,
    scaleY: canvas.getBoundingClientRect().height / SLIDE_HEIGHT,
    moved: false,
  };
  event.currentTarget.setPointerCapture(event.pointerId);
  event.currentTarget.addEventListener("pointermove", moveObjectPointer);
  event.currentTarget.addEventListener("pointerup", endObjectPointer, {
    once: true,
  });
  event.currentTarget.addEventListener("pointercancel", endObjectPointer, {
    once: true,
  });
}

function moveObjectPointer(event) {
  if (!activeGesture) return;
  const gesture = activeGesture;
  const dx = (event.clientX - gesture.startX) / gesture.scaleX;
  const dy = (event.clientY - gesture.startY) / gesture.scaleY;
  const object = gesture.object;
  if (Math.abs(dx) + Math.abs(dy) > 1) gesture.moved = true;
  if (!gesture.handle) {
    object.x = Math.round(
      Math.max(0, Math.min(SLIDE_WIDTH - object.width, gesture.x + dx)),
    );
    object.y = Math.round(
      Math.max(0, Math.min(SLIDE_HEIGHT - object.height, gesture.y + dy)),
    );
  } else {
    const handle = gesture.handle;
    let left = gesture.x;
    let top = gesture.y;
    let right = gesture.x + gesture.width;
    let bottom = gesture.y + gesture.height;
    if (handle.includes("w")) left = Math.min(right - 24, gesture.x + dx);
    if (handle.includes("e"))
      right = Math.max(left + 24, gesture.x + gesture.width + dx);
    if (handle.includes("n")) top = Math.min(bottom - 20, gesture.y + dy);
    if (handle.includes("s"))
      bottom = Math.max(top + 20, gesture.y + gesture.height + dy);
    object.x = Math.round(left);
    object.y = Math.round(top);
    object.width = Math.round(right - left);
    object.height = Math.round(bottom - top);
  }
  const element = canvas.querySelector(`[data-object-id="${object.id}"]`);
  if (element) Object.assign(element.style, objectCss(object));
  $("#selection-status").textContent =
    `${object.x}, ${object.y} · ${object.width} × ${object.height}`;
}

function endObjectPointer(event) {
  if (!activeGesture) return;
  const before = activeGesture.before;
  const moved = activeGesture.moved;
  activeGesture = null;
  event.currentTarget.removeEventListener("pointermove", moveObjectPointer);
  if (moved) {
    recordHistory(before);
    renderSlideList();
    renderInspector();
  }
}

function beginTextEditing(element, object) {
  if (element.isContentEditable) return;
  const before = snapshot();
  element.contentEditable = "true";
  element.style.userSelect = "text";
  element.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
  const finish = () => {
    element.contentEditable = "false";
    element.style.userSelect = "none";
    object.text = element.textContent;
    recordHistory(before);
    render();
  };
  element.addEventListener("blur", finish, { once: true });
  element.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      element.blur();
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      element.blur();
    }
  });
}

function renderInspector() {
  const object = selectedObject();
  propertiesContent.replaceChildren();
  if (!object) {
    const empty = document.createElement("div");
    empty.className = "empty-inspector";
    empty.innerHTML = "Select an object<br />to edit its properties";
    propertiesContent.append(empty);
    return;
  }
  const section = (title) => {
    const wrapper = document.createElement("section");
    wrapper.className = "inspector-section";
    const heading = document.createElement("div");
    heading.className = "inspector-title";
    heading.textContent = title;
    wrapper.append(heading);
    propertiesContent.append(wrapper);
    return wrapper;
  };
  const field = (parent, label, key, type = "number", options = {}) => {
    const wrapper = document.createElement("label");
    wrapper.className = `inspector-field${options.full ? " full" : ""}`;
    wrapper.append(document.createTextNode(label));
    const input = document.createElement(
      type === "select" ? "select" : "input",
    );
    if (type !== "select") input.type = type;
    if (options.min != null) input.min = options.min;
    if (options.max != null) input.max = options.max;
    if (options.step != null) input.step = options.step;
    if (type === "select")
      options.values.forEach((value) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        input.append(option);
      });
    input.value = object[key] ?? "";
    input.addEventListener("change", () =>
      updateObjectProperty(
        key,
        type === "number" ? Number(input.value) : input.value,
      ),
    );
    wrapper.append(input);
    parent.append(wrapper);
    return input;
  };
  const dimensions = section("Position & size");
  const positionRow = document.createElement("div");
  positionRow.className = "inspector-row";
  dimensions.append(positionRow);
  field(positionRow, "X", "x", "number", { min: 0, max: SLIDE_WIDTH });
  field(positionRow, "Y", "y", "number", { min: 0, max: SLIDE_HEIGHT });
  const sizeRow = document.createElement("div");
  sizeRow.className = "inspector-row";
  dimensions.append(sizeRow);
  field(sizeRow, "Width", "width", "number", { min: 10, max: SLIDE_WIDTH });
  field(sizeRow, "Height", "height", "number", { min: 10, max: SLIDE_HEIGHT });
  if (object.type === "text") {
    const text = section("Typography");
    field(text, "Font", "fontFamily", "select", {
      full: true,
      values: ["Arial", "Georgia", "Verdana", "Trebuchet MS", "Courier New"],
    });
    const row = document.createElement("div");
    row.className = "inspector-row";
    text.append(row);
    field(row, "Size", "fontSize", "number", { min: 8, max: 160 });
    field(row, "Color", "color", "color");
    for (const [label, key] of [
      ["Bold", "bold"],
      ["Italic", "italic"],
      ["Underline", "underline"],
    ]) {
      const toggle = document.createElement("label");
      toggle.className = "inspector-toggle";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!object[key];
      input.addEventListener("change", () =>
        updateObjectProperty(key, input.checked),
      );
      toggle.append(input, document.createTextNode(label));
      text.append(toggle);
    }
    field(text, "Alignment", "align", "select", {
      full: true,
      values: ["left", "center", "right"],
    });
  } else if (
    object.type === "shape" ||
    object.type === "rect" ||
    object.type === "round" ||
    object.type === "circle" ||
    object.type === "line"
  ) {
    const appearance = section("Appearance");
    if (object.type !== "line")
      field(appearance, "Fill", "fill", "color", { full: true });
    field(appearance, "Border", "border", "color", { full: true });
    field(appearance, "Border width", "borderWidth", "number", {
      min: 0,
      max: 30,
    });
  }
  const layers = section("Arrange");
  const buttons = document.createElement("div");
  buttons.className = "inspector-buttons";
  for (const [label, action] of [
    ["Bring forward", () => changeLayer(1)],
    ["Send backward", () => changeLayer(-1)],
    ["To front", () => changeLayer("front")],
    ["To back", () => changeLayer("back")],
  ]) {
    const button = document.createElement("button");
    button.textContent = label;
    button.addEventListener("click", action);
    buttons.append(button);
  }
  layers.append(buttons);
  const remove = document.createElement("button");
  remove.className = "inspector-delete";
  remove.textContent = "Delete object";
  remove.style.cssText =
    "width:100%;height:30px;margin-top:4px;border:1px solid #ead6d6;border-radius:3px;background:#fff;color:#a24848;font-size:10px;";
  remove.addEventListener("click", deleteSelected);
  layers.append(remove);
}

function updateObjectProperty(key, value) {
  const object = selectedObject();
  if (!object || Object.is(object[key], value)) return;
  transact(() => {
    object[key] = value;
  });
}

function bindTextControl(selector, key, convert = (value) => value) {
  $(selector).addEventListener("change", (event) =>
    updateObjectProperty(key, convert(event.target.value)),
  );
}

function applyTextToggle(key) {
  const object = selectedObject();
  if (object?.type === "text") updateObjectProperty(key, !object[key]);
}

function downloadDeck() {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          format: "marble-slideck",
          version: 1,
          title: deck.title,
          slides: deck.slides,
        },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${(deck.title || "Untitled Slideck").replace(/[\\/:*?"<>|]+/g, "-").trim() || "Untitled Slideck"}.slideck`;
  link.click();
  URL.revokeObjectURL(url);
}

function openDeckFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (
        !Array.isArray(data.slides) ||
        !data.slides.length ||
        !data.slides.every((slide) => Array.isArray(slide.objects))
      )
        throw new Error("Invalid Slideck file");
      deck.title =
        typeof data.title === "string" ? data.title : "Untitled Slideck";
      deck.slides = data.slides;
      currentSlideId = deck.slides[0].id || (deck.slides[0].id = makeId());
      selectedObjectId = null;
      historyPast = [];
      historyFuture = [];
      render();
    } catch (error) {
      alert(
        `This file could not be opened as a Slideck presentation. ${error.message}`,
      );
    }
  };
  reader.readAsText(file);
}

function newDeck() {
  if (
    !confirm(
      "Create a new Slideck? The current presentation is saved in this browser.",
    )
  )
    return;
  deck.title = "Untitled Slideck";
  deck.slides = [makeSlide()];
  currentSlideId = deck.slides[0].id;
  selectedObjectId = null;
  historyPast = [];
  historyFuture = [];
  render();
}

function insertImageFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () =>
    insertObject("image", {
      src: reader.result,
      alt: file.name,
      width: 420,
      height: 280,
    });
  reader.readAsDataURL(file);
}

function startPresentation() {
  presentIndex = Math.max(
    0,
    deck.slides.findIndex((slide) => slide.id === currentSlideId),
  );
  $("#present-overlay").hidden = false;
  document.body.classList.add("is-presenting");
  renderPresentation();
  document.documentElement.requestFullscreen?.().catch(() => {});
}

function stopPresentation() {
  $("#present-overlay").hidden = true;
  document.body.classList.remove("is-presenting");
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

function renderPresentation() {
  const slide = deck.slides[presentIndex];
  const target = $("#present-slide");
  target.replaceChildren();
  target.style.background = slide.background || "#fff";
  $("#present-title").textContent = deck.title;
  slide.objects.forEach((object) =>
    target.append(createObjectElement(object, false)),
  );
  $("#present-counter").textContent =
    `${presentIndex + 1} / ${deck.slides.length}`;
  $("#progress-fill").style.width =
    `${((presentIndex + 1) / deck.slides.length) * 100}%`;
}

function stepPresentation(amount) {
  const next = Math.max(
    0,
    Math.min(deck.slides.length - 1, presentIndex + amount),
  );
  if (next !== presentIndex) {
    presentIndex = next;
    renderPresentation();
  }
}

function loadAutosave() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (
      saved?.slides?.length &&
      saved.slides.every((slide) => Array.isArray(slide.objects))
    ) {
      deck.title = saved.title || deck.title;
      deck.slides = saved.slides;
      currentSlideId = deck.slides[0].id || (deck.slides[0].id = makeId());
    }
  } catch (error) {
    console.warn("Saved Slideck data could not be restored.", error);
  }
}

$(".menu-bar").addEventListener("click", (event) => {
  const trigger = event.target.closest(".menu-trigger");
  if (trigger) {
    toggleEditorMenu(trigger);
    return;
  }
  const item = event.target.closest("[data-command]");
  if (!item || item.disabled) return;
  closeEditorMenu();
  runMenuCommand(item.dataset.command);
});

document.addEventListener("pointerdown", (event) => {
  if (openMenuId && !event.target.closest(".menu-bar")) closeEditorMenu();
  if (
    !$("#editor-context-menu").hidden &&
    !event.target.closest("#editor-context-menu")
  )
    hideContextMenu();
});

$("#new-slide").addEventListener("click", addSlide);
$("#insert-text").addEventListener("click", () => insertObject("text"));
$("#insert-rect").addEventListener("click", () => insertObject("shape"));
$("#insert-round").addEventListener("click", () => insertObject("round"));
$("#insert-circle").addEventListener("click", () =>
  insertObject("circle", { width: 190, height: 190 }),
);
$("#insert-line").addEventListener("click", () =>
  insertObject("line", { width: 300, height: 5 }),
);
$("#insert-image").addEventListener("click", () => $("#image-input").click());
$("#image-input").addEventListener("change", (event) => {
  insertImageFile(event.target.files[0]);
  event.target.value = "";
});
$("#undo").addEventListener("click", undo);
$("#redo").addEventListener("click", redo);
$("#delete-object").addEventListener("click", deleteSelected);
$("#duplicate-object").addEventListener("click", duplicateSelected);
$("#layer-up").addEventListener("click", () => changeLayer(1));
$("#layer-down").addEventListener("click", () => changeLayer(-1));
$("#save-file").addEventListener("click", downloadDeck);
$("#open-file").addEventListener("click", () => $("#file-input").click());
$("#file-input").addEventListener("change", (event) => {
  openDeckFile(event.target.files[0]);
  event.target.value = "";
});
$("#new-deck").addEventListener("click", newDeck);
$("#present").addEventListener("click", startPresentation);
$("#exit-present").addEventListener("click", stopPresentation);
$("#present-prev").addEventListener("click", () => stepPresentation(-1));
$("#present-next").addEventListener("click", () => stepPresentation(1));
$("#deck-title").addEventListener("change", (event) => {
  const before = snapshot();
  deck.title = event.target.value.trim() || "Untitled Slideck";
  recordHistory(before);
  renderSlideList();
});
$("#background-color").addEventListener("input", (event) => {
  currentSlide().background = event.target.value;
  canvas.style.background = event.target.value;
  renderSlideList();
  markSaved();
});
$("#background-color").addEventListener("change", () => {
  const slide = currentSlide();
  const finalColor = slide.background;
  if (!window.backgroundBefore) return;
  slide.background = finalColor;
  recordHistory(window.backgroundBefore);
  window.backgroundBefore = null;
});
$("#background-color").addEventListener("pointerdown", () => {
  window.backgroundBefore = snapshot();
});
bindTextControl("#font-family", "fontFamily");
bindTextControl("#font-size", "fontSize", Number);
bindTextControl("#text-color", "color");
$("#text-bold").addEventListener("click", () => applyTextToggle("bold"));
$("#text-italic").addEventListener("click", () => applyTextToggle("italic"));
$("#text-underline").addEventListener("click", () =>
  applyTextToggle("underline"),
);
document
  .querySelectorAll("[data-align]")
  .forEach((button) =>
    button.addEventListener("click", () =>
      updateObjectProperty("align", button.dataset.align),
    ),
  );
canvas.addEventListener("pointerdown", (event) => {
  if (event.target === canvas) {
    selectedObjectId = null;
    renderCanvas();
    renderInspector();
  }
});
canvas.addEventListener("contextmenu", showCanvasContextMenu);

document.addEventListener("keydown", (event) => {
  if (!$("#present-overlay").hidden) {
    if (event.key === "Escape") stopPresentation();
    else if (event.key === "ArrowRight" || event.key === " ") {
      event.preventDefault();
      stepPresentation(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      stepPresentation(-1);
    }
    return;
  }
  if (!$("#editor-context-menu").hidden) {
    const contextItems = [
      ...$("#editor-context-menu").querySelectorAll("button:not(:disabled)"),
    ];
    const index = contextItems.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      hideContextMenu();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const next =
        (index + direction + contextItems.length) % contextItems.length;
      contextItems[next]?.focus();
      return;
    }
  }
  if (openMenuId) {
    const menu = $(`#${openMenuId}-menu`);
    const items = [
      ...menu.querySelectorAll('[role^="menuitem"]:not(:disabled)'),
    ];
    const index = items.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      closeEditorMenu(true);
      return;
    }
    if (event.key === "Tab") {
      closeEditorMenu();
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const nextIndex =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : event.key === "ArrowDown"
              ? (index + 1) % items.length
              : index <= 0
                ? items.length - 1
                : index - 1;
      items[nextIndex]?.focus();
      return;
    }
  }
  if (event.target.matches(".menu-trigger")) {
    const triggers = [...document.querySelectorAll(".menu-trigger")];
    const index = triggers.indexOf(event.target);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openEditorMenu(event.target, true);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      triggers[(index + direction + triggers.length) % triggers.length].focus();
      return;
    }
  }
  const editing = event.target.matches(
    'input, select, textarea, [contenteditable="true"]',
  );
  if (editing) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    undo();
  } else if (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "y"
  ) {
    event.preventDefault();
    redo();
  } else if (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "d"
  ) {
    event.preventDefault();
    duplicateSelected();
  } else if (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "c" &&
    selectedObject()
  ) {
    event.preventDefault();
    copySelected();
  } else if (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "v" &&
    copiedObject
  ) {
    event.preventDefault();
    pasteCopied();
  } else if (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "s"
  ) {
    event.preventDefault();
    downloadDeck();
  } else if (event.key === "Delete" || event.key === "Backspace")
    deleteSelected();
  else if (
    selectedObject() &&
    ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
  ) {
    event.preventDefault();
    const distance = event.shiftKey ? 10 : 1;
    const delta = {
      ArrowLeft: [-distance, 0],
      ArrowRight: [distance, 0],
      ArrowUp: [0, -distance],
      ArrowDown: [0, distance],
    }[event.key];
    transact(() => {
      const object = selectedObject();
      object.x = Math.max(
        0,
        Math.min(SLIDE_WIDTH - object.width, object.x + delta[0]),
      );
      object.y = Math.max(
        0,
        Math.min(SLIDE_HEIGHT - object.height, object.y + delta[1]),
      );
    });
  }
});

loadAutosave();
render();
