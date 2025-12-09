window.addEvent("domready", function() {
    var imageDataURL = "";
    var pixelRatio = 1;
    var toolbox = null;
    var pendingCropImage = null;

    function sendMessage(msg) {
        chrome.runtime.sendMessage(msg);
    }

    function initEditor() {
        var Canvas = new Class({
            initialize: function() {
                this.$element = $("edit-canvas");
                this.width = 0;
                this.height = 0;
                this.prepare();
            },
            prepare: function() {
                var canvasEl = this.$element;
                var img = new Image();
                var self = this;
                img.onload = function() {
                    canvasEl.setProperty("width", this.naturalWidth);
                    canvasEl.setProperty("height", this.naturalHeight);
                    pixelRatio = (function(opts) {
                        if (!opts.canvas) throw "A canvas is required";
                        if (!opts.image) throw "Image is required";
                        var canvas = opts.canvas;
                        var ctx = canvas.getContext("2d");
                        var image = opts.image;
                        var srcx = opts.srcx || 0;
                        var srcy = opts.srcy || 0;
                        var srcw = opts.srcw || image.naturalWidth;
                        var srch = opts.srch || image.naturalHeight;
                        var desx = opts.desx || srcx;
                        var desy = opts.desy || srcy;
                        var desw = opts.desw || srcw;
                        var desh = opts.desh || srch;
                        var auto = opts.auto;
                        var devicePixelRatio = window.devicePixelRatio || 1;
                        var backingStoreRatio = ctx.webkitBackingStorePixelRatio ||
                            ctx.mozBackingStorePixelRatio ||
                            ctx.msBackingStorePixelRatio ||
                            ctx.oBackingStorePixelRatio ||
                            ctx.backingStorePixelRatio || 1;
                        var ratio = devicePixelRatio / backingStoreRatio;
                        if (auto === undefined) auto = true;
                        if (auto && devicePixelRatio !== backingStoreRatio) {
                            var oldWidth = canvas.width;
                            var oldHeight = canvas.height;
                            var scale = canvas.width / oldWidth;
                            canvas.style.width = oldWidth / ratio + "px";
                            canvas.style.height = oldHeight / ratio + "px";
                            ctx.scale(scale, scale);
                        }
                        ctx.drawImage(image, srcx, srcy, srcw, srch, desx, desy, desw, desh);
                        return ratio;
                    })({image: img, canvas: canvasEl});
                    canvasEl.getContext("2d").scale(1, 1);
                    img = undefined;
                    canvasEl.getParent().setStyle("display", "");
                    self.update();

                    toolbox = new Toolbox();
                    toolbox.addTool(new Tools.Drag);
                    toolbox.addTool(new Tools.Brush);
                    toolbox.addTool(new Tools.Line);
                    toolbox.addTool(new Tools.Rectangle);
                    toolbox.addTool(new Tools.Text);
                    toolbox.addTool(new Tools.Annotation);
                    toolbox.addTool(new Tools.Emphasis);
                    toolbox.addTool(new Tools.Mosaic);
                    toolbox.addTool(new Tools.Colors);
                    toolbox.addTool(new Tools.Undo);
                    toolbox.addTool(new Tools.Redo);
                    toolbox.addTool(new Tools.Paste);
                    toolbox.addTool(new Tools.Save);
                    toolbox.addTool(new Tools.CopyToClipboard);
                    toolbox.addTool(new Tools.History);
                    toolbox.init();

                    if (pendingCropImage) {
                        setTimeout(function() {
                            var pasteTool = null;
                            for (var i = 0; i < toolbox.tools.length; i++) {
                                if (toolbox.tools[i].name === "paste") {
                                    pasteTool = toolbox.tools[i];
                                    break;
                                }
                            }
                            if (pasteTool && pendingCropImage) {
                                pasteTool.pendingImage = pendingCropImage;
                                toolbox.activateTool(pasteTool);
                                pendingCropImage = null;
                            }
                        }, 100);
                    }
                };
                img.src = imageDataURL;
            },
            update: function() {
                this.width = parseInt(this.$element.style.width || this.$element.getProperty("width"));
                this.height = parseInt(this.$element.style.height || this.$element.getProperty("height"));
            },
            setSize: function(w, h) {
                this.$element.setProperties({width: w * pixelRatio, height: h * pixelRatio});
                this.$element.style.width = w + "px";
                this.$element.style.height = h + "px";
                this.update();
            }
        });

        function defer(fn) {
            setTimeout(fn, 20);
        }

        var Toolbox = new Class({
            initialize: function() {
                this.$element = Elements.from(this.getHtml());
                this.tools = [];
                this.canvas = canvas;
                this.blocked = false;
                this.pendingActivationTool = null;
                this.currentActiveTool = null;
                this.lastActiveTool = null;
                this.$eventBox = Elements.from("<div></div>")[0];
                this.data = {color: "#FF0000", lineWidth: Math.ceil(4 / pixelRatio)};
                this.keyUpHandlers = [];
                var self = this;
                this.$element.addEvent("click:relay(.tools-wrapper a)", function(e) {
                    e.event.preventDefault();
                });
                this.$element.addEvent("dblclick", function(e) {
                    e.event.stopPropagation();
                });
                $(window).addEvent("dblclick", function(e) {
                    self.resetPosition();
                });
                $$("html").addEvent("dblclick", function(e) {
                    if (document.selection && document.selection.empty) {
                        document.selection.empty();
                    } else if (window.getSelection) {
                        window.getSelection().removeAllRanges();
                    }
                });
            },
            getHtml: function() {
                return '<div id="toolbox"><table border="0" cellpadding="0" cellspacing="0"><tr class="tools-wrapper"></tr></table></div>';
            },
            initTools: function() {
                var self = this;
                var wrapper = this.$element.getElement(".tools-wrapper")[0];
                Array.each(this.tools, function(tool, idx) {
                    tool.setToolbox(self);
                    var td = Elements.from('<td class="tool-wrapper"></td>')[0];
                    tool.$element.inject(td);
                    td.inject(wrapper);
                    tool.init();
                });
            },
            resetPosition: function() {
                var windowSize = {width: $(window).getWidth(), height: $(window).getHeight()};
                var toolboxSize = {width: this.$element[0].getWidth(), height: this.$element[0].getHeight()};
                var canvasHeight = {width: this.canvas.width, height: this.canvas.height}.height + 20;
                if (canvasHeight + toolboxSize.height + 20 > windowSize.height) {
                    canvasHeight = windowSize.height - toolboxSize.height - 20;
                    if (canvasHeight < 0) canvasHeight = 0;
                }
                var left = Math.floor(windowSize.width / 2) - Math.floor(toolboxSize.width / 2);
                if (left < 0) left = 0;
                this.$element.setStyles({top: canvasHeight + "px", left: left + "px"});
            },
            init: function() {
                this.initTools();
                this.$element.inject(document.body, "top");
                this.resetPosition();
                var self = this;
                document.onkeyup = function(e) {
                    for (const handler of self.keyUpHandlers) {
                        if (handler(e)) return;
                    }
                };
                var animClass = "capture-attention-animation";
                function removeAnim() {
                    self.$element.removeClass(animClass);
                    self.$element.removeEvent("mouseover", removeAnim);
                }
                this.$element.addClass(animClass);
                this.$element.addEvent("mouseover", removeAnim);
                setTimeout(removeAnim, 2000);
            },
            addTool: function(tool) {
                this.tools.push(tool);
            },
            activateTool: function(tool) {
                if (this.blocked) {
                    console.log("[Warning] Toolbox is blocked. Cannot activate tool.");
                    return false;
                }
                if (this.currentActiveTool === tool) {
                    console.log("[Info] Already active");
                    return false;
                }
                this.pendingActivationTool = tool;
                this.lastActiveTool = this.currentActiveTool;
                this.deactivateCurrentActiveTool();
                this.pendingActivationTool = null;
                tool.activate();
                this.currentActiveTool = tool;
                this.currentActiveTool.isActive = true;
                return true;
            },
            deactivateCurrentActiveTool: function() {
                if (this.currentActiveTool !== null) {
                    this.currentActiveTool.deactivate();
                    this.currentActiveTool.isActive = false;
                    this.currentActiveTool = null;
                }
            },
            activateToolByName: function(name) {
                var found = null;
                try {
                    Array.each(this.tools, function(tool, idx) {
                        if (tool.name == name) {
                            found = tool;
                            throw "break";
                        }
                    });
                } catch (e) {
                    if (e != "break") throw e;
                }
                if (found === null) {
                    console.log("[Warning] Tool name not found", name);
                    return false;
                }
                this.activateTool(found);
                return true;
            }
        });

        var BaseTool = new Class({
            initialize: function() {
                this.toolbox = null;
                this.isActive = false;
            },
            setToolbox: function(tb) {
                this.toolbox = tb;
            },
            name: "",
            init: function() {},
            activate: function() {},
            deactivate: function() {}
        });

        var Tools = {
            Drag: new Class({
                Extends: BaseTool,
                initialize: function() {
                    this.parent();
                    this.name = "drag";
                    this.$element = Elements.from('<div class="tool handle" title="Move the toolbar"></div>')[0];
                },
                init: function() {
                    this.makeDraggable();
                },
                makeDraggable: function() {
                    var toolboxEl = this.toolbox.$element;
                    var handle = toolboxEl.getElement(".handle")[0];
                    var offset = {x: 0, y: 0};
                    function clamp(pos) {
                        var x = pos[0], y = pos[1];
                        if (x < 0) x = 0;
                        if (y < 0) y = 0;
                        var maxX = $(window).getWidth() - toolboxEl.getWidth();
                        if (x > maxX) x = maxX;
                        var maxY = $(window).getHeight() - toolboxEl.getHeight();
                        if (y > maxY) y = maxY;
                        return [x, y];
                    }
                    function onMove(e) {
                        var x = e.event.clientX + offset.x;
                        var y = e.event.clientY + offset.y;
                        var clamped = clamp([x, y]);
                        x = clamped[0];
                        y = clamped[1];
                        toolboxEl.setStyle("left", x + "px");
                        toolboxEl.setStyle("top", y + "px");
                    }
                    function stopDrag() {
                        $(window).removeEvent("mousemove", onMove);
                    }
                    handle.addEvent("mousedown", function(e) {
                        if (e.rightClick) return;
                        var left = parseInt(toolboxEl.getStyle("left"));
                        offset.x = (isNaN(left) ? 0 : left) - e.event.clientX;
                        var top = parseInt(toolboxEl.getStyle("top"));
                        offset.y = (isNaN(top) ? 0 : top) - e.event.clientY;
                        stopDrag();
                        $(window).addEvent("mousemove", onMove);
                        e.preventDefault();
                    });
                    $(window).addEvent("mouseup", stopDrag);
                    $(window).addEvent("resize", function() {
                        var left = parseInt(toolboxEl.getStyle("left"));
                        var top = parseInt(toolboxEl.getStyle("top"));
                        var clamped = clamp([left, top]);
                        left = clamped[0];
                        top = clamped[1];
                        toolboxEl.setStyle("left", left + "px");
                        toolboxEl.setStyle("top", top + "px");
                    });
                }
            }),
            Save: new Class({
                Extends: BaseTool,
                initialize: function() {
                    this.parent();
                    this.name = "save";
                    this.notAllowedForAutoReactivation = ["undo", "redo", "upload", "drag", "crop", "save"];
                    this.$element = Elements.from('<a href="#" class="tool save-to-disk" title="Download"></a>')[0];
                },
                init: function() {
                    var self = this;
                    this.$element.addEvent("click", function(e) {
                        self.toolbox.activateTool(self);
                        defer(function() {
                            var now = new Date();
                            var dd = now.getDate();
                            var mm = now.getMonth() + 1;
                            var yyyy = now.getFullYear();
                            var hh = now.getHours();
                            var mi = now.getMinutes();
                            var ss = now.getSeconds();
                            if (dd < 10) dd = "0" + dd;
                            if (mm < 10) mm = "0" + mm;
                            if (hh < 10) hh = "0" + hh;
                            if (mi < 10) mi = "0" + mi;
                            if (ss < 10) ss = "0" + ss;
                            var filename = "Screenshot_" + dd + "-" + mm + "-" + yyyy + "_" + hh + "-" + mi + "-" + ss + ".png";
                            self.toolbox.canvas.$element.toBlob(function(blob) {
                                saveAs(blob, filename);
                            });
                        });
                    });
                },
                activate: function() {
                    this.$element.addClass("active");
                    var self = this;
                    setTimeout(function() {
                        if (self.toolbox.lastActiveTool && !self.notAllowedForAutoReactivation.contains(self.toolbox.lastActiveTool.name)) {
                            self.toolbox.activateToolByName(self.toolbox.lastActiveTool.name);
                        } else {
                            self.toolbox.deactivateCurrentActiveTool();
                        }
                    }, 12);
                },
                deactivate: function() {
                    this.$element.removeClass("active");
                }
            }),
            Upload: new Class({
                Extends: BaseTool,
                initialize: function() {
                    this.parent();
                    this.name = "upload";
                    this.$element = Elements.from('<a href="#" class="tool upload-image" title="Upload"></a>')[0];
                    this.errorTimeoutId = 0;
                    this.errorTimeoutTime = 2000;
                },
                init: function() {},
                toggleLoading: function(on) {
                    on = on || false;
                    if (on) {
                        this.$element.addClass("upload-image-loading");
                    } else {
                        this.$element.removeClass("upload-image-loading");
                    }
                },
                toggleError: function(msg) {
                    var self = this;
                    msg = msg || false;
                    if (msg) {
                        clearTimeout(this.errorTimeoutId);
                        this.$element.addClass("upload-image-error");
                        console.log(msg);
                        alert(msg);
                        this.errorTimeoutId = setTimeout(function() {
                            self.$element.removeClass("upload-image-error");
                        }, this.errorTimeoutTime);
                    }
                },
                dataUrlToBlob: function(dataUrl) {
                    var base64Marker = ";base64,";
                    if (dataUrl.indexOf(base64Marker) == -1) {
                        var parts = dataUrl.split(",");
                        var contentType = parts[0].split(":")[1];
                        var raw = parts[1];
                        return new Blob([raw], {type: contentType});
                    }
                    var parts = dataUrl.split(base64Marker);
                    var contentType = parts[0].split(":")[1];
                    var raw = window.atob(parts[1]);
                    var rawLength = raw.length;
                    var uInt8Array = new Uint8Array(rawLength);
                    for (var i = 0; i < rawLength; ++i) {
                        uInt8Array[i] = raw.charCodeAt(i);
                    }
                    return new Blob([uInt8Array], {type: contentType});
                },
                activate: function() {},
                deactivate: function() {}
            }),
            Undo: new Class({
                Extends: BaseTool,
                initialize: function() {
                    this.parent();
                    this.name = "undo";
                    this.notAllowedForAutoReactivation = ["undo", "redo", "upload", "drag", "crop", "save"];
                    this.saves = [];
                    this.$element = Elements.from('<a href="#" class="tool undo-tool" title="Undo (Ctrl+Z)"></a>')[0];
                },
                init: function() {
                    var self = this;
                    this.$element.addEvent("click", function() {
                        self.toolbox.activateTool(self);
                    });
                    this.toolbox.keyUpHandlers.push(function(e) {
                        if (e.code === "KeyZ" && e.ctrlKey && !e.shiftKey) {
                            self.$element.fireEvent("click");
                            return true;
                        }
                    });
                    this.toolbox.$eventBox.addEvent("beginChange", function() {
                        self.createSave();
                    });
                    this.toolbox.$eventBox.addEvent("beginRedo", function() {
                        self.createSave();
                    });
                    this.updateFrontEnd();
                },
                activate: function() {
                    this.$element.addClass("active");
                    this.recoverSave();
                    this.updateFrontEnd();
                    var self = this;
                    setTimeout(function() {
                        if (self.toolbox.lastActiveTool && !self.notAllowedForAutoReactivation.contains(self.toolbox.lastActiveTool.name)) {
                            self.toolbox.activateToolByName(self.toolbox.lastActiveTool.name);
                        } else {
                            self.toolbox.deactivateCurrentActiveTool();
                        }
                    }, 12);
                },
                deactivate: function() {
                    this.$element.removeClass("active");
                },
                updateFrontEnd: function() {
                    if (this.saves.length > 0) {
                        this.$element.removeClass("empty");
                    } else {
                        this.$element.addClass("empty");
                    }
                },
                recoverSave: function() {
                    if (this.saves.length < 1) return false;
                    this.toolbox.$eventBox.fireEvent("beginUndo");
                    var save = this.saves.pop();
                    var canvasObj = this.toolbox.canvas;
                    var img = new Image();
                    var ctx = canvasObj.$element.getContext("2d");
                    img.onload = function() {
                        canvasObj.setSize(save.dimension.width, save.dimension.height);
                        URL.revokeObjectURL(save.imageURL);
                        save = undefined;
                        ctx.drawImage(img, 0, 0);
                        img = undefined;
                    };
                    img.src = save.imageURL;
                },
                createSave: function() {
                    var self = this;
                    var dim = {height: self.toolbox.canvas.height, width: self.toolbox.canvas.width};
                    this.toolbox.canvas.$element.toBlob(function(blob) {
                        self.saves.push({imageURL: URL.createObjectURL(blob), dimension: dim});
                        self.updateFrontEnd();
                    }, "image/png");
                }
            }),
            Redo: new Class({
                Extends: BaseTool,
                initialize: function() {
                    this.parent();
                    this.name = "redo";
                    this.notAllowedForAutoReactivation = ["undo", "redo", "upload", "drag", "crop", "save"];
                    this.saves = [];
                    this.$element = Elements.from('<a href="#" class="tool redo-tool" title="Redo (Ctrl+Shift+Z)"></a>')[0];
                },
                init: function() {
                    var self = this;
                    this.$element.addEvent("click", function() {
                        self.toolbox.activateTool(self);
                    });
                    this.toolbox.keyUpHandlers.push(function(e) {
                        if (e.code === "KeyZ" && e.ctrlKey && e.shiftKey) {
                            self.$element.fireEvent("click");
                            return true;
                        }
                    });
                    this.toolbox.$eventBox.addEvent("beginUndo", function() {
                        self.createSave();
                    });
                    this.toolbox.$eventBox.addEvent("beginChange", function() {
                        self.clearSaves();
                    });
                    this.updateFrontEnd();
                },
                activate: function() {
                    this.$element.addClass("active");
                    this.recoverSave();
                    this.updateFrontEnd();
                    var self = this;
                    setTimeout(function() {
                        if (self.toolbox.lastActiveTool && !self.notAllowedForAutoReactivation.contains(self.toolbox.lastActiveTool.name)) {
                            self.toolbox.activateToolByName(self.toolbox.lastActiveTool.name);
                        } else {
                            self.toolbox.deactivateCurrentActiveTool();
                        }
                    }, 12);
                },
                deactivate: function() {
                    this.$element.removeClass("active");
                },
                updateFrontEnd: function() {
                    if (this.saves.length > 0) {
                        this.$element.removeClass("empty");
                    } else {
                        this.$element.addClass("empty");
                    }
                },
                createSave: function() {
                    var self = this;
                    var dim = {height: this.toolbox.canvas.height, width: this.toolbox.canvas.width};
                    this.toolbox.canvas.$element.toBlob(function(blob) {
                        self.saves.push({imageURL: URL.createObjectURL(blob), dimension: dim});
                        self.updateFrontEnd();
                    }, "image/png");
                },
                recoverSave: function() {
                    if (this.saves.length < 1) return false;
                    this.toolbox.$eventBox.fireEvent("beginRedo");
                    var save = this.saves.pop();
                    var canvasObj = this.toolbox.canvas;
                    var img = new Image();
                    var ctx = canvasObj.$element.getContext("2d");
                    img.onload = function() {
                        canvasObj.setSize(save.dimension.width, save.dimension.height);
                        URL.revokeObjectURL(save.imageURL);
                        save = undefined;
                        ctx.drawImage(img, 0, 0);
                        img = undefined;
                    };
                    img.src = save.imageURL;
                },
                clearSaves: function() {
                    this.saves.forEach(function(save) {
                        URL.revokeObjectURL(save.imageURL);
                    });
                    this.saves = [];
                    this.updateFrontEnd();
                }
            }),
            Brush: new Class({
                Extends: BaseTool,
                initialize: function() {
                    this.parent();
                    this.name = "brush";
                    this.$element = Elements.from('<a href="#" class="tool brush-tool" title="Brush"></a>')[0];
                    this.$canvas = Elements.from('<canvas class="brush-tool-canvas"></canvas>')[0];
                    this.ctx = this.$canvas.getContext("2d");
                },
                init: function() {
                    var self = this;
                    this.$element.addEvent("click", function() {
                        self.toolbox.activateTool(self);
                    });
                    this.$canvas.addEvent("mousedown", function(e) {
                        if (e.rightClick) return;
                        e.preventDefault();
                        self.handleMouseDown(e);
                    });
                },
                activate: function() {
                    var self = this;
                    this.$element.addClass("active");
                    defer(function() {
                        self.$canvas.inject(self.toolbox.canvas.$element.getParent(), "top");
                        self.reset();
                    });
                },
                deactivate: function() {
                    this.$element.removeClass("active");
                    this.toolbox.canvas.$element.getParent().getElement(".brush-tool-canvas").dispose();
                },
                reset: function() {
                    this.mouse = {x: -100, y: -100};
                    this.mousex = {x: -100, y: -100};
                    this.mouseMoved = false;
                    this.$canvas.setProperties({height: this.toolbox.canvas.height, width: this.toolbox.canvas.width});
                    this.ctx.clearRect(0, 0, this.toolbox.canvas.width, this.toolbox.canvas.height);
                },
                handleMouseDown: function(e) {
                    var self = this;
                    var onMove = function(e) { self.handleMouseMove(e); };
                    $(window).addEvent("mousemove", onMove);
                    var onUp = function(e) {
                        $(window).removeEvent("mouseup", onUp);
                        $(window).removeEvent("mousemove", onMove);
                        self.handleMouseUp(e);
                    };
                    $(window).addEvent("mouseup", onUp);
                    var coords = this.$canvas.getCoordinates();
                    this.mouse.x = e.event.pageX - coords.left;
                    this.mouse.y = e.event.pageY - coords.top;
                    this.mousex = Object.clone(this.mouse);
                    this.ctx.lineWidth = this.toolbox.data.lineWidth;
                    this.ctx.strokeStyle = this.toolbox.data.color;
                    this.ctx.lineCap = "round";
                    this.ctx.lineJoin = "round";
                },
                handleMouseMove: function(e) {
                    this.mouseMoved = true;
                    var prev = Object.clone(this.mouse);
                    var coords = this.$canvas.getCoordinates();
                    this.mouse.x = e.event.pageX - coords.left;
                    this.mouse.y = e.event.pageY - coords.top;
                    this.ctx.beginPath();
                    this.ctx.moveTo(this.mousex.x, this.mousex.y);
                    this.ctx.lineTo(prev.x, prev.y);
                    this.ctx.lineTo(this.mouse.x, this.mouse.y);
                    this.ctx.stroke();
                    this.ctx.closePath();
                    this.mousex = Object.clone(prev);
                },
                handleMouseUp: function(e) {
                    if (!this.mouseMoved) {
                        this.reset();
                        return false;
                    }
                    this.toolbox.$eventBox.fireEvent("beginChange");
                    this.toolbox.canvas.$element.getContext("2d").drawImage(this.$canvas, 0, 0, this.$canvas.width * pixelRatio, this.$canvas.height * pixelRatio);
                    this.reset();
                }
            }),
            Colors: new Class({
                Extends: BaseTool,
                initialize: function() {
                    this.parent();
                    this.name = "colors";
                    this.currentColorIsDark = null;
                    this.$element = Elements.from('<div class="tool colors-tool" ><input type="color" title="Color" /></div>')[0];
                    this.$elements = {inputColor: this.$element.getElement('input[type="color"]')};
                },
                init: function() {
                    var self = this;
                    this.$element.addEvent("click", function() {
                        self.toolbox.activateTool(self);
                    });
                    this.$elements.inputColor.addEvent("change", function() {
                        self.toolbox.data.color = this.value;
                        self.updateFrontend();
                    });
                    this.toolbox.data.color = "#FF0000";
                    this.clickCanvasCallback = function(e) {
                        self.handleCanvasClick(e);
                    };
                    this.updateFrontend();
                },
                activate: function() {
                    this.$element.addClass("active");
                    this.toolbox.canvas.$element.addClass("colors-tool-canvas");
                    this.toolbox.canvas.$element.addEvent("click", this.clickCanvasCallback);
                },
                deactivate: function() {
                    this.$element.removeClass("active");
                    this.toolbox.canvas.$element.removeClass("colors-tool-canvas");
                    this.toolbox.canvas.$element.removeEvent("click", this.clickCanvasCallback);
                },
                updateFrontend: function() {
                    this.$element.setStyle("background-color", this.toolbox.data.color);
                    var isDark = this.isColorDark(this.toolbox.data.color);
                    do {
                        if (isDark === this.currentColorIsDark) break;
                        this.currentColorIsDark = isDark;
                        if (isDark) {
                            this.$element.addClass("dark-color");
                        } else {
                            this.$element.removeClass("dark-color");
                        }
                    } while (0);
                },
                handleCanvasClick: function(e) {
                    var coords = this.toolbox.canvas.$element.getCoordinates();
                    var x = e.event.pageX - coords.left;
                    var y = e.event.pageY - coords.top;
                    var data = this.toolbox.canvas.$element.getContext("2d").getImageData(x * pixelRatio, y * pixelRatio, 1, 1).data;
                    this.toolbox.data.color = this.$elements.inputColor.value = this.rgbToHex(data[0], data[1], data[2]);
                    this.updateFrontend();
                },
                isColorDark: function(hex) {
                    var color = hex;
                    color = color.substring(1);
                    var brightness = (299 * parseInt(color.substr(0, 2), 16) + 587 * parseInt(color.substr(2, 2), 16) + 114 * parseInt(color.substr(4, 2), 16)) / 1000;
                    return !(brightness >= 128);
                },
                rgbToHex: function(r, g, b) {
                    var hex = "#";
                    Array.each([r, g, b], function(val) {
                        var h = val.toString(16);
                        if (val < 16) h = "0" + h;
                        hex += h;
                    });
                    return hex;
                }
            }),
            Line: new Class({
                Extends: BaseTool,
                initialize: function() {
                    this.parent();
                    this.name = "line";
                    var self = this;
                    this.$element = Elements.from('<a href="#" class="tool line-tool arrow" title="Arrow / Line"></a>')[0];
                    this.$canvas = Elements.from('<canvas class="line-tool-canvas"></canvas>')[0];
                    this.ctx = this.$canvas.getContext("2d");
                    this.$canvas.addEvent("mousedown", function(e) {
                        if (e.rightClick) return;
                        e.preventDefault();
                        self.handleMouseDown(e);
                    });
                    this.arrow = true;
                },
                init: function() {
                    var self = this;
                    this.reset();
                    this.$element.addEvent("click", function() {
                        if (self.isActive) {
                            self.toggleArrow();
                        } else {
                            self.toolbox.activateTool(self);
                        }
                    });
                },
                reset: function() {
                    this.mouse = {begin: {x: -100, y: -100}, end: {x: -100, y: -100}};
                    this.last = {min: {x: 0, y: 0}, max: {x: 0, y: 0}};
                    this.mouseMoved = false;
                    this.$canvas.setProperties({height: this.toolbox.canvas.height, width: this.toolbox.canvas.width});
                    this.ctx.clearRect(0, 0, this.toolbox.canvas.width, this.toolbox.canvas.height);
                },
                activate: function() {
                    var self = this;
                    this.$element.addClass("active");
                    defer(function() {
                        self.$canvas.inject(self.toolbox.canvas.$element.getParent(), "top");
                        self.reset();
                    });
                },
                deactivate: function() {
                    this.$element.removeClass("active");
                    this.toolbox.canvas.$element.getParent().getElement(".line-tool-canvas").dispose();
                    this.reset();
                },
                handleMouseDown: function(e) {
                    var self = this;
                    $(window).removeEvent("keyup", this.keyUpCallback);
                    var onMove = function(e) { self.handleMouseMove(e); };
                    $(window).addEvent("mousemove", onMove);
                    var onUp = function(e) {
                        $(window).removeEvent("mouseup", onUp);
                        $(window).removeEvent("mousemove", onMove);
                        self.handleMouseUp(e);
                    };
                    $(window).addEvent("mouseup", onUp);
                    var coords = this.$canvas.getCoordinates();
                    this.mouse.begin.x = this.mouse.end.x = e.event.pageX - coords.left;
                    this.mouse.begin.y = this.mouse.end.y = e.event.pageY - coords.top;
                },
                handleMouseMove: function(e) {
                    var coords = this.$canvas.getCoordinates();
                    this.mouse.end.x = e.event.pageX - coords.left;
                    this.mouse.end.y = e.event.pageY - coords.top;
                    this.mouseMoved = true;
                    this.drawLine();
                },
                handleMouseUp: function(e) {
                    if (!this.mouseMoved) {
                        this.reset();
                        return false;
                    }
                    this.toolbox.$eventBox.fireEvent("beginChange");
                    this.toolbox.canvas.$element.getContext("2d").drawImage(this.$canvas, 0, 0, this.$canvas.width * pixelRatio, this.$canvas.height * pixelRatio);
                    this.reset();
                },
                drawLine: function() {
                    var self = this;
                    var maxPos = {x: -4294967295, y: -4294967295};
                    var minPos = {x: 4294967295, y: 4294967295};
                    Array.each(["begin", "end"], function(key) {
                        Array.each(["x", "y"], function(axis) {
                            if (maxPos[axis] < self.mouse[key][axis]) maxPos[axis] = self.mouse[key][axis];
                            if (minPos[axis] > self.mouse[key][axis]) minPos[axis] = self.mouse[key][axis];
                        });
                    });
                    var arrowData;
                    if (this.arrow) {
                        arrowData = {size: 13};
                        arrowData.angle = Math.atan2(this.mouse.end.y - this.mouse.begin.y, this.mouse.end.x - this.mouse.begin.x);
                        arrowData.right = {
                            x: this.mouse.end.x - arrowData.size * Math.cos(arrowData.angle - Math.PI / 9),
                            y: this.mouse.end.y - arrowData.size * Math.sin(arrowData.angle - Math.PI / 9)
                        };
                        arrowData.left = {
                            x: this.mouse.end.x - arrowData.size * Math.cos(arrowData.angle + Math.PI / 9),
                            y: this.mouse.end.y - arrowData.size * Math.sin(arrowData.angle + Math.PI / 9)
                        };
                    }
                    var clearSize = this.toolbox.data.lineWidth;
                    if (this.arrow) clearSize += arrowData.size;
                    this.ctx.clearRect(this.last.min.x - clearSize, this.last.min.y - clearSize, this.last.max.x - this.last.min.x + 2 * clearSize, this.last.max.y - this.last.min.y + 2 * clearSize);
                    this.ctx.beginPath();
                    this.ctx.moveTo(this.mouse.begin.x, this.mouse.begin.y);
                    this.ctx.lineTo(this.mouse.end.x, this.mouse.end.y);
                    if (this.arrow) {
                        this.ctx.moveTo(this.mouse.end.x, this.mouse.end.y);
                        this.ctx.lineTo(arrowData.left.x, arrowData.left.y);
                        this.ctx.lineTo(this.mouse.end.x, this.mouse.end.y);
                        this.ctx.lineTo(arrowData.right.x, arrowData.right.y);
                        this.ctx.lineTo(arrowData.left.x, arrowData.left.y);
                        this.ctx.lineTo(this.mouse.end.x, this.mouse.end.y);
                    }
                    this.ctx.lineWidth = this.toolbox.data.lineWidth;
                    this.ctx.strokeStyle = this.toolbox.data.color;
                    this.ctx.fillStyle = this.toolbox.data.color;
                    this.ctx.lineCap = "round";
                    this.ctx.fill();
                    this.ctx.stroke();
                    this.ctx.closePath();
                    this.last.min = Object.clone(minPos);
                    this.last.max = Object.clone(maxPos);
                },
                toggleArrow: function(val) {
                    this.arrow = val === undefined ? !this.arrow : Boolean(val);
                    if (this.arrow) {
                        this.$element.addClass("arrow");
                    } else {
                        this.$element.removeClass("arrow");
                    }
                }
            }),
            Rectangle: new Class({
                Extends: BaseTool,
                initialize: function() {
                    this.parent();
                    this.name = "rectangle";
                    this.$element = Elements.from('<a href="#" class="tool rectangle-tool" title="Rectangle"></a>')[0];
                    this.$canvas = Elements.from('<canvas class="rectangle-tool-canvas"></canvas>')[0];
                    this.ctx = this.$canvas.getContext("2d");
                    this.fill = false;
                    this.$edit = Elements.from('<div class="rectangle-edit"><div class="resize resize-top"></div><div class="resize resize-top-right"></div><div class="resize resize-right"></div><div class="resize resize-right-bottom"></div><div class="resize resize-bottom"></div><div class="resize resize-bottom-left"></div><div class="resize resize-left"></div><div class="resize resize-left-top"></div></div>')[0];
                    this.disableAutoSaveForTools = ["redo"];
                },
                init: function() {
                    var self = this;
                    this.reset();
                    this.$element.addEvent("click", function() {
                        if (self.isActive) {
                            self.toggleFill();
                        } else {
                            self.toolbox.activateTool(self);
                        }
                    });
                    this.$canvas.addEvent("mousedown", function(e) {
                        if (e.rightClick) return;
                        e.preventDefault();
                        self.handleMouseDown(e);
                    });
                    this.$edit.addEvent("mousedown", function(e) {
                        if (e.rightClick) return;
                        e.preventDefault();
                        self.handleEditMouseDown(e);
                    });
                    this.$edit.getElements(".resize").addEvent("mousedown", function(e) {
                        if (e.rightClick) return;
                        e.preventDefault();
                        e.stopPropagation();
                        self.handleResizeMouseDown(e);
                    });
                },
                reset: function() {
                    this.mouse = {begin: {x: -100, y: -100}, end: {x: -100, y: -100}};
                    this.last = {min: {x: 0, y: 0}, max: {x: 0, y: 0}};
                    this.mouseMoved = false;
                    this.$canvas.setProperties({height: this.toolbox.canvas.height, width: this.toolbox.canvas.width});
                    this.ctx.clearRect(0, 0, this.toolbox.canvas.width, this.toolbox.canvas.height);
                    this.resizeMode = {top: false, right: false, bottom: false, left: false};
                    this.$edit.setStyle("display", "none");
                    this.$edit.getElements(".resize").setProperty("style", "");
                    this.editMouseDownShift = {x: 0, y: 0};
                },
                activate: function() {
                    var self = this;
                    this.$element.addClass("active");
                    defer(function() {
                        self.$edit.inject(self.toolbox.canvas.$element.getParent(), "top");
                        self.$canvas.inject(self.toolbox.canvas.$element.getParent(), "top");
                        self.reset();
                    });
                },
                deactivate: function() {
                    if (!this.disableAutoSaveForTools.contains(this.toolbox.pendingActivationTool.name)) {
                        this.save();
                    }
                    this.$element.removeClass("active");
                    this.toolbox.canvas.$element.getParent().getElement(".rectangle-tool-canvas").dispose();
                    this.toolbox.canvas.$element.getParent().getElement(".rectangle-edit").dispose();
                    this.reset();
                },
                toggleFill: function(val) {
                    this.fill = val === undefined ? !this.fill : Boolean(val);
                    if (this.fill) {
                        this.$element.addClass("fill");
                    } else {
                        this.$element.removeClass("fill");
                    }
                },
                handleMouseDown: function(e) {
                    this.save();
                    var self = this;
                    $(window).removeEvent("keyup", this.keyUpCallback);
                    var onMove = function(e) { self.handleMouseMove(e); };
                    $(window).addEvent("mousemove", onMove);
                    var onUp = function(e) {
                        $(window).removeEvent("mouseup", onUp);
                        $(window).removeEvent("mousemove", onMove);
                        self.handleMouseUp(e);
                    };
                    $(window).addEvent("mouseup", onUp);
                    var coords = this.$canvas.getCoordinates();
                    this.mouse.begin.x = this.mouse.end.x = e.event.pageX - coords.left;
                    this.mouse.begin.y = this.mouse.end.y = e.event.pageY - coords.top;
                },
                handleMouseMove: function(e) {
                    var coords = this.$canvas.getCoordinates();
                    this.mouse.end.x = e.event.pageX - coords.left;
                    this.mouse.end.y = e.event.pageY - coords.top;
                    if (!this.mouseMoved) this.$edit.setStyle("display", "");
                    this.mouseMoved = true;
                    this.drawRectangle();
                },
                handleMouseUp: function(e) {
                    if (!this.mouseMoved) {
                        this.reset();
                        return false;
                    }
                    this.useFixedMouse();
                },
                save: function() {
                    if (!this.isReady()) return;
                    this.toolbox.$eventBox.fireEvent("beginChange");
                    this.toolbox.canvas.$element.getContext("2d").drawImage(this.$canvas, 0, 0, this.$canvas.width * pixelRatio, this.$canvas.height * pixelRatio);
                    this.reset();
                },
                drawRectangle: function() {
                    var fixed = this.getFixedMouse();
                    var minPos = fixed[0];
                    var maxPos = fixed[1];
                    var w = maxPos.x - minPos.x;
                    var h = maxPos.y - minPos.y;
                    var lineWidth = this.toolbox.data.lineWidth;
                    this.ctx.clearRect(this.last.min.x - lineWidth - 3, this.last.min.y - lineWidth - 3, this.last.max.x - this.last.min.x + 2 * (lineWidth + 3), this.last.max.y - this.last.min.y + 2 * (lineWidth + 3));
                    this.ctx.beginPath();
                    this.ctx.lineWidth = lineWidth;
                    this.ctx.strokeStyle = this.toolbox.data.color;
                    if (this.fill) {
                        this.ctx.rect(minPos.x, minPos.y, w, h);
                        this.ctx.fillStyle = this.toolbox.data.color;
                        this.ctx.fill();
                    } else {
                        this.roundRect(this.ctx, minPos.x, minPos.y, w, h, 3);
                    }
                    this.ctx.stroke();
                    this.ctx.closePath();
                    this.$edit.setStyles({left: minPos.x + "px", top: minPos.y + "px", width: w + "px", height: h + "px"});
                    this.last.min = Object.clone(minPos);
                    this.last.max = Object.clone(maxPos);
                },
                roundRect: function(ctx, x, y, w, h, r) {
                    ctx.moveTo(x + r, y);
                    ctx.lineTo(x + w - r, y);
                    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
                    ctx.lineTo(x + w, y + h - r);
                    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
                    ctx.lineTo(x + r, y + h);
                    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
                    ctx.lineTo(x, y + r);
                    ctx.quadraticCurveTo(x, y, x + r, y);
                },
                handleResizeMouseDown: function(e) {
                    var self = this;
                    var onMove = function(e) { self.handleResizeMouseMove(e); };
                    $(window).addEvent("mousemove", onMove);
                    var onUp = function(e) {
                        $(window).removeEvent("mouseup", onUp);
                        $(window).removeEvent("mousemove", onMove);
                        self.handleResizeMouseUp(e);
                    };
                    $(window).addEvent("mouseup", onUp);
                    this.resizeMode = {top: false, right: false, bottom: false, left: false};
                    var target = e.target;
                    if (target.hasClass("resize-top")) this.resizeMode.top = true;
                    else if (target.hasClass("resize-right")) this.resizeMode.right = true;
                    else if (target.hasClass("resize-bottom")) this.resizeMode.bottom = true;
                    else if (target.hasClass("resize-left")) this.resizeMode.left = true;
                    else if (target.hasClass("resize-top-right")) { this.resizeMode.top = true; this.resizeMode.right = true; }
                    else if (target.hasClass("resize-right-bottom")) { this.resizeMode.right = true; this.resizeMode.bottom = true; }
                    else if (target.hasClass("resize-bottom-left")) { this.resizeMode.bottom = true; this.resizeMode.left = true; }
                    else if (target.hasClass("resize-left-top")) { this.resizeMode.left = true; this.resizeMode.top = true; }
                },
                handleResizeMouseMove: function(e) {
                    var coords = this.$canvas.getCoordinates();
                    if (this.resizeMode.left) this.mouse.begin.x = e.event.pageX - coords.left;
                    if (this.resizeMode.right) this.mouse.end.x = e.event.pageX - coords.left;
                    if (this.resizeMode.top) this.mouse.begin.y = e.event.pageY - coords.top;
                    if (this.resizeMode.bottom) this.mouse.end.y = e.event.pageY - coords.top;
                    this.drawRectangle();
                },
                handleResizeMouseUp: function(e) {
                    this.isReady();
                },
                isReady: function() {
                    this.useFixedMouse();
                    var h = this.mouse.end.y - this.mouse.begin.y;
                    var w = this.mouse.end.x - this.mouse.begin.x;
                    return h > 0 && w > 0;
                },
                getFixedMouse: function() {
                    var self = this;
                    var maxPos = {x: -4294967295, y: -4294967295};
                    var minPos = {x: 4294967295, y: 4294967295};
                    Array.each(["begin", "end"], function(key) {
                        Array.each(["x", "y"], function(axis) {
                            if (maxPos[axis] < self.mouse[key][axis]) maxPos[axis] = self.mouse[key][axis];
                            if (minPos[axis] > self.mouse[key][axis]) minPos[axis] = self.mouse[key][axis];
                        });
                    });
                    return [minPos, maxPos];
                },
                useFixedMouse: function() {
                    var fixed = this.getFixedMouse();
                    this.mouse.begin = fixed[0];
                    this.mouse.end = fixed[1];
                },
                handleEditMouseDown: function(e) {
                    var self = this;
                    var left = parseInt(this.$edit.getStyle("left"));
                    this.editMouseDownShift.x = (isNaN(left) ? 0 : left) - e.event.clientX;
                    var top = parseInt(this.$edit.getStyle("top"));
                    this.editMouseDownShift.y = (isNaN(top) ? 0 : top) - e.event.clientY;
                    var onMove = function(e) { self.handleEditMouseMove(e); };
                    $(window).addEvent("mousemove", onMove);
                    var onUp = function(e) {
                        $(window).removeEvent("mouseup", onUp);
                        $(window).removeEvent("mousemove", onMove);
                        self.handleEditMouseUp(e);
                    };
                    $(window).addEvent("mouseup", onUp);
                },
                handleEditMouseMove: function(e) {
                    var newLeft = e.event.clientX + this.editMouseDownShift.x;
                    var newTop = e.event.clientY + this.editMouseDownShift.y;
                    var dx = this.mouse.begin.x - newLeft;
                    this.mouse.begin.x -= dx;
                    this.mouse.end.x -= dx;
                    var dy = this.mouse.begin.y - newTop;
                    this.mouse.begin.y -= dy;
                    this.mouse.end.y -= dy;
                    this.drawRectangle();
                },
                handleEditMouseUp: function(e) {}
            }),
            Text: new Class({
                Extends: BaseTool,
                initialize: function() {
                    this.parent();
                    this.name = "text";
                    this.$element = Elements.from('<a href="#" class="tool text-tool" title="Text"></a>')[0];
                    this.$cover = Elements.from('<div id="text-tool-cover"></div>')[0];
                    this.$editor = Elements.from('<div id="text-editor"><div class="drag"></div><textarea spellcheck="false"></textarea></div>')[0];
                    this.$elements = {drag: this.$editor.getElement(".drag"), textarea: this.$editor.getElement("textarea")};
                },
                init: function() {
                    this.ctx = this.toolbox.canvas.$element.getContext("2d");
                    var self = this;
                    this.$element.addEvent("click", function() {
                        self.toolbox.activateTool(self);
                    });
                    this.$editor.addEvent("dblclick", function(e) {
                        e.stopPropagation();
                    });
                    this.$cover.addEvent("click", function(e) {
                        if (e.rightClick) return;
                        self.takeShot();
                        self.reset();
                        var coords = self.$cover.getCoordinates();
                        var x = e.event.pageX - coords.left;
                        var y = e.event.pageY - coords.top;
                        self.placeEditor(x, y);
                    });
                    this.$elements.textarea.addEvents({
                        keyup: function() { self.fixTextarea(); },
                        keydown: function() { self.fixTextarea(); },
                        blur: function() { self.fixTextarea(); },
                        change: function() { self.fixTextarea(); }
                    });
                    this.makeDraggable();
                },
                reset: function() {
                    this.$elements.textarea.set("value", "");
                    this.$elements.textarea.setAttribute("cols", "2");
                    this.$elements.textarea.setAttribute("rows", "2");
                    this.$elements.textarea.setAttribute("disabled", "disabled");
                    this.$elements.textarea.setStyles({color: this.toolbox.data.color, "border-color": this.toolbox.data.color});
                    this.ctx.fillStyle = this.toolbox.data.color;
                    this.$editor.setStyles({top: "-100px", left: "-100px", display: "none"});
                    this.fixTextarea();
                },
                activate: function() {
                    var self = this;
                    this.$element.addClass("active");
                    defer(function() {
                        self.$editor.inject(self.toolbox.canvas.$element.getParent(), "top");
                        self.$cover.inject(self.toolbox.canvas.$element.getParent(), "top");
                        self.reset();
                    });
                },
                deactivate: function() {
                    this.takeShot();
                    this.$element.removeClass("active");
                    this.toolbox.canvas.$element.getParent().getElement("#text-editor").dispose();
                    this.toolbox.canvas.$element.getParent().getElement("#text-tool-cover").dispose();
                    this.reset();
                },
                makeDraggable: function() {
                    var editorEl = this.$editor;
                    var dragEl = this.$elements.drag;
                    var offset = {x: 0, y: 0};
                    function onMove(e) {
                        var x = e.event.clientX + offset.x;
                        var y = e.event.clientY + offset.y;
                        editorEl.setStyle("left", x + "px");
                        editorEl.setStyle("top", y + "px");
                    }
                    function stopDrag() {
                        $(window).removeEvent("mousemove", onMove);
                    }
                    dragEl.addEvent("mousedown", function(e) {
                        if (e.rightClick) return;
                        var left = parseInt(editorEl.getStyle("left"));
                        offset.x = (isNaN(left) ? 0 : left) - e.event.clientX;
                        var top = parseInt(editorEl.getStyle("top"));
                        offset.y = (isNaN(top) ? 0 : top) - e.event.clientY;
                        stopDrag();
                        $(window).addEvent("mousemove", onMove);
                        e.preventDefault();
                    });
                    $(window).addEvent("mouseup", stopDrag);
                    $(window).addEvent("resize", function() {
                        var left = parseInt(editorEl.getStyle("left"));
                        var top = parseInt(editorEl.getStyle("top"));
                        editorEl.setStyle("left", left + "px");
                        editorEl.setStyle("top", top + "px");
                    });
                },
                takeShot: function() {
                    var text = this.$elements.textarea.get("value").trim();
                    if (text.length < 1) return;
                    var x = parseInt(this.$editor.getStyle("left")) + 3;
                    var y = parseInt(this.$editor.getStyle("top")) + 15 + parseInt(1 / pixelRatio);
                    this.toolbox.$eventBox.fireEvent("beginChange");
                    this.ctx.font = "bold " + 14 * pixelRatio + "px monospace";
                    var self = this;
                    var lineNum = 0;
                    Array.each(text.split("\n"), function(line) {
                        self.ctx.fillText(line, x * pixelRatio, (y + 16 * lineNum) * pixelRatio);
                        lineNum++;
                    });
                },
                placeEditor: function(x, y) {
                    this.$editor.setStyles({top: y - 12 + "px", left: x - 4 + "px", display: ""});
                    this.$elements.textarea.removeAttribute("disabled");
                    this.$elements.textarea.focus();
                },
                fixTextarea: function() {
                    var lines = this.$elements.textarea.get("value").split("\n");
                    this.$elements.textarea.setAttribute("rows", lines.length + 1);
                    var cols = 2;
                    Array.each(lines, function(line) {
                        if (line.length > cols - 2) cols = line.length + 2;
                    });
                    this.$elements.textarea.setAttribute("cols", cols);
                    this.$elements.textarea.setStyle("width", cols + "ch");
                }
            }),
            Annotation: new Class({
                Extends: BaseTool,
                initialize: function() {
                    this.parent();
                    this.name = "annotation";
                    this.$element = Elements.from('<a href="#" class="tool annotation-tool" title="Number Stamp (click to place)"></a>')[0];
                    this.$cover = null;
                    this.currentNumber = 1;
                    this.stampSize = 24;
                },
                init: function() {
                    var self = this;
                    this.$element.addEvent("click", function() {
                        self.toolbox.activateTool(self);
                    });
                },
                activate: function() {
                    var self = this;
                    this.$element.addClass("active");
                    this.$cover = Elements.from('<div class="annotation-tool-cover"></div>')[0];
                    this.$cover.inject(this.toolbox.canvas.$element.getParent(), "top");
                    this.clickHandler = function(e) {
                        if (e.rightClick) return;
                        self.placeStamp(e);
                    };
                    this.$cover.addEvent("click", this.clickHandler);
                    this.updateCursor();
                },
                deactivate: function() {
                    this.$element.removeClass("active");
                    if (this.$cover) {
                        this.$cover.removeEvent("click", this.clickHandler);
                        if (this.$cover.parentNode) {
                            this.$cover.parentNode.removeChild(this.$cover);
                        }
                        this.$cover = null;
                    }
                },
                updateCursor: function() {
                    if (!this.$cover) return;
                    // Create a canvas for the cursor
                    var cursorCanvas = document.createElement("canvas");
                    var size = this.stampSize + 4;
                    cursorCanvas.width = size;
                    cursorCanvas.height = size;
                    var ctx = cursorCanvas.getContext("2d");
                    this.drawStamp(ctx, size / 2, size / 2, this.currentNumber, this.stampSize);
                    var cursorUrl = cursorCanvas.toDataURL();
                    this.$cover.setStyle("cursor", "url(" + cursorUrl + ") " + (size / 2) + " " + (size / 2) + ", crosshair");
                },
                placeStamp: function(e) {
                    var coords = this.$cover.getCoordinates();
                    var x = e.event.pageX - coords.left;
                    var y = e.event.pageY - coords.top;
                    this.toolbox.$eventBox.fireEvent("beginChange");
                    var ctx = this.toolbox.canvas.$element.getContext("2d");
                    this.drawStamp(ctx, x * pixelRatio, y * pixelRatio, this.currentNumber, this.stampSize * pixelRatio);
                    this.currentNumber++;
                    this.updateCursor();
                },
                drawStamp: function(ctx, x, y, number, size) {
                    var radius = size / 2;
                    var color = this.toolbox ? this.toolbox.data.color : "#FF0000";
                    // Draw circle
                    ctx.beginPath();
                    ctx.arc(x, y, radius, 0, Math.PI * 2);
                    ctx.fillStyle = color;
                    ctx.fill();
                    ctx.closePath();
                    // Draw white border
                    ctx.beginPath();
                    ctx.arc(x, y, radius, 0, Math.PI * 2);
                    ctx.strokeStyle = "#FFFFFF";
                    ctx.lineWidth = Math.max(2, size / 12);
                    ctx.stroke();
                    ctx.closePath();
                    // Draw number
                    ctx.fillStyle = "#FFFFFF";
                    ctx.font = "bold " + Math.floor(size * 0.6) + "px Arial, sans-serif";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(String(number), x, y + 1);
                },
                resetCounter: function() {
                    this.currentNumber = 1;
                    this.updateCursor();
                }
            }),
            Emphasis: new Class({
                Extends: BaseTool,
                initialize: function() {
                    this.parent();
                    this.name = "emphasis";
                    this.$element = Elements.from('<a href="#" class="tool emphasis-tool" title="Emphasis Stamp (click icon to change style)"></a>')[0];
                    this.$cover = null;
                    this.stampSize = 32;
                    this.styleIndex = 0;
                    this.styles = ["star", "exclamation", "important", "check", "question"];
                },
                init: function() {
                    var self = this;
                    this.$element.addEvent("click", function(e) {
                        if (e.rightClick) return;
                        if (self.isActive) {
                            // Already active - cycle style
                            self.cycleStyle();
                        } else {
                            // Not active - activate tool
                            self.toolbox.activateTool(self);
                        }
                    });
                },
                cycleStyle: function() {
                    this.styleIndex = (this.styleIndex + 1) % this.styles.length;
                    this.updateIcon();
                    if (this.$cover) {
                        this.updateCursor();
                    }
                },
                updateIcon: function() {
                    var style = this.styles[this.styleIndex];
                    var isActive = this.$element.hasClass("active");
                    this.$element.className = "tool emphasis-tool " + style;
                    if (isActive) {
                        this.$element.addClass("active");
                    }
                },
                activate: function() {
                    var self = this;
                    this.$element.addClass("active");
                    this.$cover = Elements.from('<div class="emphasis-tool-cover"></div>')[0];
                    this.$cover.inject(this.toolbox.canvas.$element.getParent(), "top");
                    this.clickHandler = function(e) {
                        if (e.rightClick) return;
                        self.placeStamp(e);
                    };
                    this.$cover.addEvent("click", this.clickHandler);
                    this.updateCursor();
                },
                deactivate: function() {
                    this.$element.removeClass("active");
                    if (this.$cover) {
                        this.$cover.removeEvent("click", this.clickHandler);
                        if (this.$cover.parentNode) {
                            this.$cover.parentNode.removeChild(this.$cover);
                        }
                        this.$cover = null;
                    }
                },
                updateCursor: function() {
                    if (!this.$cover) return;
                    var cursorCanvas = document.createElement("canvas");
                    var size = this.stampSize + 4;
                    cursorCanvas.width = size;
                    cursorCanvas.height = size;
                    var ctx = cursorCanvas.getContext("2d");
                    this.drawStamp(ctx, size / 2, size / 2, this.stampSize);
                    var cursorUrl = cursorCanvas.toDataURL();
                    this.$cover.setStyle("cursor", "url(" + cursorUrl + ") " + (size / 2) + " " + (size / 2) + ", crosshair");
                },
                placeStamp: function(e) {
                    var coords = this.$cover.getCoordinates();
                    var x = e.event.pageX - coords.left;
                    var y = e.event.pageY - coords.top;
                    this.toolbox.$eventBox.fireEvent("beginChange");
                    var ctx = this.toolbox.canvas.$element.getContext("2d");
                    this.drawStamp(ctx, x * pixelRatio, y * pixelRatio, this.stampSize * pixelRatio);
                },
                drawStamp: function(ctx, x, y, size) {
                    var style = this.styles[this.styleIndex];
                    var color = this.toolbox ? this.toolbox.data.color : "#FF0000";
                    ctx.save();
                    if (style === "star") {
                        this.drawStar(ctx, x, y, size, color);
                    } else if (style === "exclamation") {
                        this.drawExclamation(ctx, x, y, size, color);
                    } else if (style === "important") {
                        this.drawImportant(ctx, x, y, size, color);
                    } else if (style === "check") {
                        this.drawCheck(ctx, x, y, size, color);
                    } else if (style === "question") {
                        this.drawQuestion(ctx, x, y, size, color);
                    }
                    ctx.restore();
                },
                drawLabel: function(ctx, x, y, size, color, label) {
                    var fontSize = Math.floor(size * 0.4);
                    ctx.font = "bold " + fontSize + "px Arial, sans-serif";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "top";
                    // Draw text shadow/outline for readability
                    ctx.strokeStyle = "#FFFFFF";
                    ctx.lineWidth = Math.max(3, fontSize / 4);
                    ctx.lineJoin = "round";
                    ctx.strokeText(label, x, y + size / 2 + 2);
                    // Draw text
                    ctx.fillStyle = color;
                    ctx.fillText(label, x, y + size / 2 + 2);
                },
                drawStar: function(ctx, x, y, size, color) {
                    var outerRadius = size / 2;
                    var innerRadius = outerRadius * 0.4;
                    var spikes = 5;
                    ctx.beginPath();
                    for (var i = 0; i < spikes * 2; i++) {
                        var radius = i % 2 === 0 ? outerRadius : innerRadius;
                        var angle = (Math.PI / 2 * 3) + (i * Math.PI / spikes);
                        var px = x + Math.cos(angle) * radius;
                        var py = y + Math.sin(angle) * radius;
                        if (i === 0) ctx.moveTo(px, py);
                        else ctx.lineTo(px, py);
                    }
                    ctx.closePath();
                    ctx.fillStyle = color;
                    ctx.fill();
                    ctx.strokeStyle = "#FFFFFF";
                    ctx.lineWidth = Math.max(2, size / 16);
                    ctx.stroke();
                    // Label
                    this.drawLabel(ctx, x, y, size, color, "重要");
                },
                drawExclamation: function(ctx, x, y, size, color) {
                    var radius = size / 2;
                    // Circle background
                    ctx.beginPath();
                    ctx.arc(x, y, radius, 0, Math.PI * 2);
                    ctx.fillStyle = color;
                    ctx.fill();
                    ctx.strokeStyle = "#FFFFFF";
                    ctx.lineWidth = Math.max(2, size / 12);
                    ctx.stroke();
                    // Exclamation mark
                    ctx.fillStyle = "#FFFFFF";
                    ctx.font = "bold " + Math.floor(size * 0.7) + "px Arial, sans-serif";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText("!", x, y + 1);
                    // Label
                    this.drawLabel(ctx, x, y, size, color, "注目");
                },
                drawImportant: function(ctx, x, y, size, color) {
                    var radius = size / 2;
                    // Triangle background
                    ctx.beginPath();
                    ctx.moveTo(x, y - radius);
                    ctx.lineTo(x + radius * 0.9, y + radius * 0.7);
                    ctx.lineTo(x - radius * 0.9, y + radius * 0.7);
                    ctx.closePath();
                    ctx.fillStyle = color;
                    ctx.fill();
                    ctx.strokeStyle = "#FFFFFF";
                    ctx.lineWidth = Math.max(2, size / 12);
                    ctx.stroke();
                    // Exclamation in triangle
                    ctx.fillStyle = "#FFFFFF";
                    ctx.font = "bold " + Math.floor(size * 0.5) + "px Arial, sans-serif";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText("!", x, y + size * 0.1);
                    // Label
                    this.drawLabel(ctx, x, y, size, color, "警告");
                },
                drawCheck: function(ctx, x, y, size, color) {
                    var radius = size / 2;
                    // Circle background
                    ctx.beginPath();
                    ctx.arc(x, y, radius, 0, Math.PI * 2);
                    ctx.fillStyle = color;
                    ctx.fill();
                    ctx.strokeStyle = "#FFFFFF";
                    ctx.lineWidth = Math.max(2, size / 12);
                    ctx.stroke();
                    // Checkmark
                    ctx.strokeStyle = "#FFFFFF";
                    ctx.lineWidth = Math.max(3, size / 8);
                    ctx.lineCap = "round";
                    ctx.lineJoin = "round";
                    ctx.beginPath();
                    ctx.moveTo(x - radius * 0.4, y);
                    ctx.lineTo(x - radius * 0.1, y + radius * 0.35);
                    ctx.lineTo(x + radius * 0.4, y - radius * 0.3);
                    ctx.stroke();
                    // Label
                    this.drawLabel(ctx, x, y, size, color, "OK");
                },
                drawQuestion: function(ctx, x, y, size, color) {
                    var radius = size / 2;
                    // Circle background
                    ctx.beginPath();
                    ctx.arc(x, y, radius, 0, Math.PI * 2);
                    ctx.fillStyle = color;
                    ctx.fill();
                    ctx.strokeStyle = "#FFFFFF";
                    ctx.lineWidth = Math.max(2, size / 12);
                    ctx.stroke();
                    // Question mark
                    ctx.fillStyle = "#FFFFFF";
                    ctx.font = "bold " + Math.floor(size * 0.65) + "px Arial, sans-serif";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText("?", x, y + 1);
                    // Label
                    this.drawLabel(ctx, x, y, size, color, "確認");
                }
            }),
            Mosaic: new Class({
                Extends: BaseTool,
                initialize: function() {
                    this.parent();
                    this.name = "mosaic";
                    this.$element = Elements.from('<a href="#" class="tool mosaic-tool" title="Mosaic (drag to select area)"></a>')[0];
                    this.$cover = null;
                    this.$selection = null;
                    this.blockSize = 10;
                    this.mouse = {begin: {x: 0, y: 0}, end: {x: 0, y: 0}};
                    this.isDragging = false;
                },
                init: function() {
                    var self = this;
                    this.$element.addEvent("click", function() {
                        self.toolbox.activateTool(self);
                    });
                },
                activate: function() {
                    var self = this;
                    this.$element.addClass("active");
                    this.$cover = Elements.from('<div class="mosaic-tool-cover"></div>')[0];
                    this.$selection = Elements.from('<div class="mosaic-selection"></div>')[0];
                    this.$cover.inject(this.toolbox.canvas.$element.getParent(), "top");
                    this.$selection.inject(this.toolbox.canvas.$element.getParent(), "top");
                    this.$selection.setStyle("display", "none");
                    this.mouseDownHandler = function(e) {
                        if (e.rightClick) return;
                        e.preventDefault();
                        self.handleMouseDown(e);
                    };
                    this.$cover.addEvent("mousedown", this.mouseDownHandler);
                },
                deactivate: function() {
                    this.$element.removeClass("active");
                    if (this.$cover) {
                        this.$cover.removeEvent("mousedown", this.mouseDownHandler);
                        if (this.$cover.parentNode) {
                            this.$cover.parentNode.removeChild(this.$cover);
                        }
                        this.$cover = null;
                    }
                    if (this.$selection) {
                        if (this.$selection.parentNode) {
                            this.$selection.parentNode.removeChild(this.$selection);
                        }
                        this.$selection = null;
                    }
                },
                handleMouseDown: function(e) {
                    var self = this;
                    var coords = this.$cover.getCoordinates();
                    this.mouse.begin.x = e.event.pageX - coords.left;
                    this.mouse.begin.y = e.event.pageY - coords.top;
                    this.mouse.end.x = this.mouse.begin.x;
                    this.mouse.end.y = this.mouse.begin.y;
                    this.isDragging = true;
                    this.$selection.setStyle("display", "block");
                    this.updateSelection();
                    var onMove = function(ev) { self.handleMouseMove(ev); };
                    var onUp = function(ev) {
                        $(window).removeEvent("mousemove", onMove);
                        $(window).removeEvent("mouseup", onUp);
                        self.handleMouseUp(ev);
                    };
                    $(window).addEvent("mousemove", onMove);
                    $(window).addEvent("mouseup", onUp);
                },
                handleMouseMove: function(e) {
                    if (!this.isDragging) return;
                    var coords = this.$cover.getCoordinates();
                    this.mouse.end.x = e.event.pageX - coords.left;
                    this.mouse.end.y = e.event.pageY - coords.top;
                    this.updateSelection();
                },
                handleMouseUp: function(e) {
                    this.isDragging = false;
                    this.$selection.setStyle("display", "none");
                    var rect = this.getSelectionRect();
                    if (rect.width > 5 && rect.height > 5) {
                        this.applyMosaic(rect);
                    }
                },
                updateSelection: function() {
                    var rect = this.getSelectionRect();
                    this.$selection.setStyles({
                        left: rect.x + "px",
                        top: rect.y + "px",
                        width: rect.width + "px",
                        height: rect.height + "px"
                    });
                },
                getSelectionRect: function() {
                    var x = Math.min(this.mouse.begin.x, this.mouse.end.x);
                    var y = Math.min(this.mouse.begin.y, this.mouse.end.y);
                    var width = Math.abs(this.mouse.end.x - this.mouse.begin.x);
                    var height = Math.abs(this.mouse.end.y - this.mouse.begin.y);
                    return {x: x, y: y, width: width, height: height};
                },
                applyMosaic: function(rect) {
                    this.toolbox.$eventBox.fireEvent("beginChange");
                    var canvas = this.toolbox.canvas.$element;
                    var ctx = canvas.getContext("2d");
                    var x = Math.floor(rect.x * pixelRatio);
                    var y = Math.floor(rect.y * pixelRatio);
                    var width = Math.floor(rect.width * pixelRatio);
                    var height = Math.floor(rect.height * pixelRatio);
                    // Clamp to canvas bounds
                    if (x < 0) { width += x; x = 0; }
                    if (y < 0) { height += y; y = 0; }
                    if (x + width > canvas.width) width = canvas.width - x;
                    if (y + height > canvas.height) height = canvas.height - y;
                    if (width <= 0 || height <= 0) return;
                    var blockSize = Math.floor(this.blockSize * pixelRatio);
                    var imageData = ctx.getImageData(x, y, width, height);
                    var data = imageData.data;
                    // Process each block
                    for (var by = 0; by < height; by += blockSize) {
                        for (var bx = 0; bx < width; bx += blockSize) {
                            var blockW = Math.min(blockSize, width - bx);
                            var blockH = Math.min(blockSize, height - by);
                            // Calculate average color of block
                            var r = 0, g = 0, b = 0, a = 0, count = 0;
                            for (var py = 0; py < blockH; py++) {
                                for (var px = 0; px < blockW; px++) {
                                    var idx = ((by + py) * width + (bx + px)) * 4;
                                    r += data[idx];
                                    g += data[idx + 1];
                                    b += data[idx + 2];
                                    a += data[idx + 3];
                                    count++;
                                }
                            }
                            r = Math.floor(r / count);
                            g = Math.floor(g / count);
                            b = Math.floor(b / count);
                            a = Math.floor(a / count);
                            // Fill block with average color
                            for (var py = 0; py < blockH; py++) {
                                for (var px = 0; px < blockW; px++) {
                                    var idx = ((by + py) * width + (bx + px)) * 4;
                                    data[idx] = r;
                                    data[idx + 1] = g;
                                    data[idx + 2] = b;
                                    data[idx + 3] = a;
                                }
                            }
                        }
                    }
                    ctx.putImageData(imageData, x, y);
                }
            }),
            Paste: new Class({
                Extends: BaseTool,
                initialize: function() {
                    this.parent();
                    this.name = "paste";
                    this.notAllowedForAutoReactivation = ["undo", "redo", "upload", "drag", "crop", "save", "paste"];
                    this.$element = Elements.from('<a href="#" class="tool paste-tool" title="Paste from Clipboard (Ctrl+V)"></a>')[0];
                    this.$preview = null;
                    this.$cover = null;
                    this.$resizeContainer = null;
                    this.pendingImage = null;
                    this.mousePos = {x: 0, y: 0};
                    this.imagePos = {x: 0, y: 0};
                    this.imageSize = {w: 0, h: 0};
                    this.originalSize = {w: 0, h: 0};
                    this.isPlaced = false;
                    this.isResizing = false;
                    this.isDragging = false;
                    this.resizeHandle = null;
                    this.resizeStart = {x: 0, y: 0, w: 0, h: 0, posX: 0, posY: 0};
                    this.dragStart = {x: 0, y: 0, posX: 0, posY: 0};
                },
                init: function() {
                    var self = this;
                    this.$element.addEvent("click", function() {
                        self.pasteFromClipboard();
                    });
                    this.toolbox.keyUpHandlers.push(function(e) {
                        if (e.code === "KeyV" && e.ctrlKey && !e.shiftKey) {
                            self.pasteFromClipboard();
                            return true;
                        }
                    });
                },
                pasteFromClipboard: function() {
                    var self = this;
                    navigator.clipboard.read().then(function(items) {
                        for (var i = 0; i < items.length; i++) {
                            var item = items[i];
                            if (item.types.includes("image/png")) {
                                item.getType("image/png").then(function(blob) {
                                    self.loadImageFromBlob(blob);
                                });
                                return;
                            }
                            if (item.types.includes("image/jpeg")) {
                                item.getType("image/jpeg").then(function(blob) {
                                    self.loadImageFromBlob(blob);
                                });
                                return;
                            }
                        }
                        alert("No image found in clipboard");
                    }).catch(function(err) {
                        console.error("Failed to read clipboard:", err);
                        alert("Failed to read clipboard. Please allow clipboard access.");
                    });
                },
                loadImageFromBlob: function(blob) {
                    var self = this;
                    var img = new Image();
                    img.onload = function() {
                        self.pendingImage = img;
                        self.toolbox.activateTool(self);
                    };
                    img.src = URL.createObjectURL(blob);
                },
                activate: function() {
                    this.$element.addClass("active");
                    var self = this;
                    if (this.pendingImage) {
                        this.$cover = Elements.from('<div class="paste-tool-cover"></div>')[0];
                        this.$preview = Elements.from('<img class="paste-preview">')[0];
                        this.$resizeContainer = Elements.from('<div class="paste-resize-container"><div class="paste-resize-handle nw"></div><div class="paste-resize-handle ne"></div><div class="paste-resize-handle sw"></div><div class="paste-resize-handle se"></div></div>')[0];
                        this.$preview.src = this.pendingImage.src;
                        var w = this.pendingImage.naturalWidth / pixelRatio;
                        var h = this.pendingImage.naturalHeight / pixelRatio;
                        this.originalSize = {w: w, h: h};
                        this.imageSize = {w: w, h: h};
                        this.$preview.setStyles({width: w + "px", height: h + "px"});
                        this.$cover.inject(this.toolbox.canvas.$element.getParent(), "top");
                        this.$preview.inject(this.toolbox.canvas.$element.getParent(), "top");
                        this.$resizeContainer.setStyles({display: "none"});
                        this.$resizeContainer.inject(this.toolbox.canvas.$element.getParent(), "top");
                        this.isPlaced = false;
                        this.mouseMoveHandler = function(e) { self.handleMouseMove(e); };
                        this.mouseClickHandler = function(e) { self.handleMouseClick(e); };
                        this.keyHandler = function(e) {
                            if (e.key === "Escape") self.toolbox.deactivateCurrentActiveTool();
                            if (e.key === "Enter" && self.isPlaced) self.commitImage();
                        };
                        this.$cover.addEvent("mousemove", this.mouseMoveHandler);
                        this.$cover.addEvent("click", this.mouseClickHandler);
                        $(window).addEvent("keyup", this.keyHandler);
                        // Resize handle events
                        this.$resizeContainer.getElements(".paste-resize-handle").addEvent("mousedown", function(e) {
                            e.stopPropagation();
                            self.startResize(e, this);
                        });
                        // Drag image when clicking on container (not handles)
                        this.$resizeContainer.addEvent("mousedown", function(e) {
                            if (!e.target.hasClass("paste-resize-handle")) {
                                self.startDrag(e);
                            }
                        });
                        // Double click to commit
                        this.$resizeContainer.addEvent("dblclick", function(e) {
                            e.stopPropagation();
                            self.commitImage();
                        });
                    } else {
                        setTimeout(function() {
                            if (self.toolbox.lastActiveTool && !self.notAllowedForAutoReactivation.contains(self.toolbox.lastActiveTool.name)) {
                                self.toolbox.activateToolByName(self.toolbox.lastActiveTool.name);
                            } else {
                                self.toolbox.deactivateCurrentActiveTool();
                            }
                        }, 12);
                    }
                },
                handleMouseMove: function(e) {
                    var coords = this.$cover.getCoordinates();
                    this.mousePos.x = e.event.pageX - coords.left;
                    this.mousePos.y = e.event.pageY - coords.top;
                    var w = this.pendingImage.naturalWidth / pixelRatio;
                    var h = this.pendingImage.naturalHeight / pixelRatio;
                    var left = this.mousePos.x - w / 2;
                    var top = this.mousePos.y - h / 2;
                    this.$preview.setStyles({left: left + "px", top: top + "px"});
                },
                handleMouseClick: function(e) {
                    if (e.rightClick) {
                        this.cleanup();
                        return false;
                    }
                    if (this.isPlaced) {
                        // Click outside the resize container - commit the image
                        this.commitImage();
                        return;
                    }
                    var coords = this.$cover.getCoordinates();
                    var x = e.event.pageX - coords.left;
                    var y = e.event.pageY - coords.top;
                    var w = this.imageSize.w;
                    var h = this.imageSize.h;
                    var drawX = x - w / 2;
                    var drawY = y - h / 2;
                    // Place the image and show resize handles
                    this.imagePos = {x: drawX, y: drawY};
                    this.isPlaced = true;
                    this.$preview.setStyles({left: drawX + "px", top: drawY + "px"});
                    this.$resizeContainer.setStyles({
                        display: "block",
                        left: drawX + "px",
                        top: drawY + "px",
                        width: w + "px",
                        height: h + "px"
                    });
                    this.$cover.removeEvent("mousemove", this.mouseMoveHandler);
                },
                commitImage: function() {
                    if (!this.pendingImage) return;
                    this.toolbox.$eventBox.fireEvent("beginChange");
                    var ctx = this.toolbox.canvas.$element.getContext("2d");
                    ctx.drawImage(this.pendingImage, this.imagePos.x * pixelRatio, this.imagePos.y * pixelRatio, this.imageSize.w * pixelRatio, this.imageSize.h * pixelRatio);
                    this.cleanup();
                },
                startResize: function(e, handle) {
                    var self = this;
                    this.isResizing = true;
                    this.resizeHandle = handle.className.replace("paste-resize-handle ", "");
                    this.resizeStart = {
                        x: e.event.clientX,
                        y: e.event.clientY,
                        w: this.imageSize.w,
                        h: this.imageSize.h,
                        posX: this.imagePos.x,
                        posY: this.imagePos.y
                    };
                    var onMove = function(ev) { self.handleResize(ev); };
                    var onUp = function() {
                        self.isResizing = false;
                        $(window).removeEvent("mousemove", onMove);
                        $(window).removeEvent("mouseup", onUp);
                    };
                    $(window).addEvent("mousemove", onMove);
                    $(window).addEvent("mouseup", onUp);
                    e.event.preventDefault();
                },
                handleResize: function(e) {
                    var dx = e.event.clientX - this.resizeStart.x;
                    var dy = e.event.clientY - this.resizeStart.y;
                    var aspectRatio = this.originalSize.w / this.originalSize.h;
                    var newW = this.resizeStart.w;
                    var newH = this.resizeStart.h;
                    var newX = this.resizeStart.posX;
                    var newY = this.resizeStart.posY;
                    // Use the larger delta to maintain aspect ratio
                    var delta = Math.abs(dx) > Math.abs(dy) ? dx : dy * aspectRatio;
                    if (this.resizeHandle === "se") {
                        newW = Math.max(20, this.resizeStart.w + delta);
                        newH = newW / aspectRatio;
                    } else if (this.resizeHandle === "sw") {
                        newW = Math.max(20, this.resizeStart.w - delta);
                        newH = newW / aspectRatio;
                        newX = this.resizeStart.posX + (this.resizeStart.w - newW);
                    } else if (this.resizeHandle === "ne") {
                        newW = Math.max(20, this.resizeStart.w + delta);
                        newH = newW / aspectRatio;
                        newY = this.resizeStart.posY + (this.resizeStart.h - newH);
                    } else if (this.resizeHandle === "nw") {
                        newW = Math.max(20, this.resizeStart.w - delta);
                        newH = newW / aspectRatio;
                        newX = this.resizeStart.posX + (this.resizeStart.w - newW);
                        newY = this.resizeStart.posY + (this.resizeStart.h - newH);
                    }
                    this.imageSize = {w: newW, h: newH};
                    this.imagePos = {x: newX, y: newY};
                    this.$preview.setStyles({
                        left: newX + "px",
                        top: newY + "px",
                        width: newW + "px",
                        height: newH + "px"
                    });
                    this.$resizeContainer.setStyles({
                        left: newX + "px",
                        top: newY + "px",
                        width: newW + "px",
                        height: newH + "px"
                    });
                },
                startDrag: function(e) {
                    var self = this;
                    this.isDragging = true;
                    this.dragStart = {
                        x: e.event.clientX,
                        y: e.event.clientY,
                        posX: this.imagePos.x,
                        posY: this.imagePos.y
                    };
                    var onMove = function(ev) { self.handleDrag(ev); };
                    var onUp = function() {
                        self.isDragging = false;
                        $(window).removeEvent("mousemove", onMove);
                        $(window).removeEvent("mouseup", onUp);
                    };
                    $(window).addEvent("mousemove", onMove);
                    $(window).addEvent("mouseup", onUp);
                    e.event.preventDefault();
                },
                handleDrag: function(e) {
                    var dx = e.event.clientX - this.dragStart.x;
                    var dy = e.event.clientY - this.dragStart.y;
                    var newX = this.dragStart.posX + dx;
                    var newY = this.dragStart.posY + dy;
                    this.imagePos = {x: newX, y: newY};
                    this.$preview.setStyles({left: newX + "px", top: newY + "px"});
                    this.$resizeContainer.setStyles({left: newX + "px", top: newY + "px"});
                },
                cleanup: function() {
                    // Remove cover element immediately
                    if (this.$cover) {
                        if (this.$cover.parentNode) {
                            this.$cover.parentNode.removeChild(this.$cover);
                        }
                        this.$cover = null;
                    }
                    // Remove preview element immediately
                    if (this.$preview) {
                        if (this.$preview.parentNode) {
                            this.$preview.parentNode.removeChild(this.$preview);
                        }
                        this.$preview = null;
                    }
                    // Remove resize container
                    if (this.$resizeContainer) {
                        if (this.$resizeContainer.parentNode) {
                            this.$resizeContainer.parentNode.removeChild(this.$resizeContainer);
                        }
                        this.$resizeContainer = null;
                    }
                    // Also remove by class name as fallback
                    var covers = document.querySelectorAll('.paste-tool-cover');
                    for (var i = 0; i < covers.length; i++) {
                        covers[i].parentNode.removeChild(covers[i]);
                    }
                    var previews = document.querySelectorAll('.paste-preview');
                    for (var j = 0; j < previews.length; j++) {
                        previews[j].parentNode.removeChild(previews[j]);
                    }
                    var resizeContainers = document.querySelectorAll('.paste-resize-container');
                    for (var k = 0; k < resizeContainers.length; k++) {
                        resizeContainers[k].parentNode.removeChild(resizeContainers[k]);
                    }
                    // Clean up pending image
                    if (this.pendingImage) {
                        if (this.pendingImage.src && this.pendingImage.src.indexOf("blob:") === 0) {
                            URL.revokeObjectURL(this.pendingImage.src);
                        }
                        this.pendingImage = null;
                    }
                    // Reset state
                    this.isPlaced = false;
                    this.isResizing = false;
                    this.isDragging = false;
                    pendingCropImage = null;
                    $(window).removeEvent("keyup", this.keyHandler);
                    this.$element.removeClass("active");
                    this.isActive = false;
                    this.toolbox.currentActiveTool = null;
                },
                deactivate: function() {
                    this.cleanup();
                }
            }),
            CopyToClipboard: new Class({
                Extends: BaseTool,
                initialize: function() {
                    this.parent();
                    this.name = "copy";
                    this.notAllowedForAutoReactivation = ["undo", "redo", "upload", "drag", "save", "copy"];
                    this.$element = Elements.from('<a href="#" class="tool copy-to-clipboard" title="Copy to Clipboard"></a>')[0];
                },
                init: function() {
                    var self = this;
                    this.$element.addEvent("click", function(e) {
                        self.toolbox.activateTool(self);
                        defer(function() {
                            self.toolbox.canvas.$element.toBlob(function(blob) {
                                navigator.clipboard.write([
                                    new ClipboardItem({"image/png": blob})
                                ]).then(function() {
                                    self.$element.addClass("copy-success");
                                    setTimeout(function() {
                                        self.$element.removeClass("copy-success");
                                    }, 1000);
                                }).catch(function(err) {
                                    console.error("Failed to copy to clipboard:", err);
                                    alert("クリップボードへのコピーに失敗しました");
                                });
                            }, "image/png");
                        });
                    });
                },
                activate: function() {
                    this.$element.addClass("active");
                    var self = this;
                    setTimeout(function() {
                        if (self.toolbox.lastActiveTool && !self.notAllowedForAutoReactivation.contains(self.toolbox.lastActiveTool.name)) {
                            self.toolbox.activateToolByName(self.toolbox.lastActiveTool.name);
                        } else {
                            self.toolbox.deactivateCurrentActiveTool();
                        }
                    }, 12);
                },
                deactivate: function() {
                    this.$element.removeClass("active");
                }
            }),
            History: new Class({
                Extends: BaseTool,
                initialize: function() {
                    this.parent();
                    this.name = "history";
                    this.notAllowedForAutoReactivation = ["undo", "redo", "upload", "drag", "save", "copy", "history"];
                    this.$element = Elements.from('<a href="#" class="tool history-tool" title="History Panel"></a>')[0];
                    this.$panel = null;
                    this.storageKey = "grareco_history";
                    this.maxItems = 20;
                },
                init: function() {
                    var self = this;
                    this.$element.addEvent("click", function(e) {
                        if (e.rightClick) return;
                        if (self.isActive) {
                            self.toolbox.deactivateCurrentActiveTool();
                        } else {
                            self.toolbox.activateTool(self);
                        }
                    });
                },
                activate: function() {
                    this.$element.addClass("active");
                    this.showPanel();
                },
                deactivate: function() {
                    this.$element.removeClass("active");
                    this.hidePanel();
                },
                showPanel: function() {
                    var self = this;
                    if (this.$panel) return;
                    this.$panel = Elements.from('<div class="history-panel"><div class="history-header"><span class="history-title">履歴</span><button class="history-save-btn">現在の画像を保存</button><button class="history-close-btn">×</button></div><div class="history-list"></div></div>')[0];
                    document.body.appendChild(this.$panel);
                    // Close button
                    this.$panel.getElement(".history-close-btn").addEvent("click", function() {
                        self.toolbox.deactivateCurrentActiveTool();
                    });
                    // Save button
                    this.$panel.getElement(".history-save-btn").addEvent("click", function() {
                        self.saveCurrentImage();
                    });
                    this.renderHistoryList();
                },
                hidePanel: function() {
                    if (this.$panel) {
                        if (this.$panel.parentNode) {
                            this.$panel.parentNode.removeChild(this.$panel);
                        }
                        this.$panel = null;
                    }
                },
                getHistory: function() {
                    try {
                        var data = localStorage.getItem(this.storageKey);
                        return data ? JSON.parse(data) : [];
                    } catch (e) {
                        return [];
                    }
                },
                saveHistory: function(history) {
                    try {
                        localStorage.setItem(this.storageKey, JSON.stringify(history));
                    } catch (e) {
                        console.error("Failed to save history:", e);
                    }
                },
                saveCurrentImage: function() {
                    var self = this;
                    var title = prompt("タイトルを入力してください:", "スケッチ " + new Date().toLocaleString("ja-JP"));
                    if (title === null) return;
                    if (!title.trim()) title = "無題 " + new Date().toLocaleString("ja-JP");
                    this.toolbox.canvas.$element.toBlob(function(blob) {
                        var reader = new FileReader();
                        reader.onload = function() {
                            var history = self.getHistory();
                            var item = {
                                id: Date.now(),
                                title: title,
                                thumbnail: reader.result,
                                createdAt: new Date().toISOString()
                            };
                            history.unshift(item);
                            if (history.length > self.maxItems) {
                                history = history.slice(0, self.maxItems);
                            }
                            self.saveHistory(history);
                            self.renderHistoryList();
                        };
                        reader.readAsDataURL(blob);
                    }, "image/png", 0.8);
                },
                loadImage: function(item) {
                    var self = this;
                    var img = new Image();
                    img.onload = function() {
                        self.toolbox.$eventBox.fireEvent("beginChange");
                        var canvas = self.toolbox.canvas.$element;
                        var ctx = canvas.getContext("2d");
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                        ctx.fillStyle = "#FFFFFF";
                        ctx.fillRect(0, 0, canvas.width, canvas.height);
                        var scale = Math.min(canvas.width / img.width, canvas.height / img.height);
                        var w = img.width * scale;
                        var h = img.height * scale;
                        var x = (canvas.width - w) / 2;
                        var y = (canvas.height - h) / 2;
                        ctx.drawImage(img, x, y, w, h);
                        self.toolbox.deactivateCurrentActiveTool();
                    };
                    img.src = item.thumbnail;
                },
                deleteItem: function(id) {
                    var history = this.getHistory();
                    history = history.filter(function(item) { return item.id !== id; });
                    this.saveHistory(history);
                    this.renderHistoryList();
                },
                renderHistoryList: function() {
                    var self = this;
                    if (!this.$panel) return;
                    var $list = this.$panel.getElement(".history-list");
                    $list.empty();
                    var history = this.getHistory();
                    if (history.length === 0) {
                        $list.innerHTML = '<div class="history-empty">保存された履歴がありません</div>';
                        return;
                    }
                    history.forEach(function(item) {
                        var $item = Elements.from('<div class="history-item" data-id="' + item.id + '"><img class="history-thumbnail" src="' + item.thumbnail + '"><div class="history-info"><div class="history-item-title">' + self.escapeHtml(item.title) + '</div><div class="history-item-date">' + new Date(item.createdAt).toLocaleString("ja-JP") + '</div></div><button class="history-delete-btn" title="削除">×</button></div>')[0];
                        $item.getElement(".history-thumbnail").addEvent("click", function() {
                            if (confirm("この画像を読み込みますか？\n現在の編集内容は失われます。")) {
                                self.loadImage(item);
                            }
                        });
                        $item.getElement(".history-delete-btn").addEvent("click", function(e) {
                            e.stopPropagation();
                            if (confirm("この履歴を削除しますか？")) {
                                self.deleteItem(item.id);
                            }
                        });
                        $list.appendChild($item);
                    });
                },
                escapeHtml: function(text) {
                    var div = document.createElement("div");
                    div.textContent = text;
                    return div.innerHTML;
                }
            })
        };

        var canvas = new Canvas();
    }

    var commandsExecuted = {};
    chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
        if (msg.cmd === "edit:ready") {
            if (commandsExecuted[msg.cmd] !== undefined) {
                console.log("This command can run only once");
                return;
            }
            if (!msg.imageURL) {
                $$("#image-wrapper").setStyle("display", "none");
                return false;
            }
            $$("#screensaver").setStyle("display", "none");
            $$("#image-wrapper").setStyle("display", "");

            var screenSize = {width: 1920, height: 1080};

            if (msg.cropData) {
                fetch(msg.imageURL).then(function(res) { return res.blob(); }).then(function(blob) {
                    var blobURL = URL.createObjectURL(blob);
                    var fullImg = new Image();
                    fullImg.onload = function() {
                        screenSize.width = Math.floor(fullImg.naturalWidth / window.devicePixelRatio);
                        screenSize.height = Math.floor(fullImg.naturalHeight / window.devicePixelRatio);

                        var cropInfo = msg.cropData;
                        var tempCanvas = document.createElement("canvas");
                        tempCanvas.width = cropInfo.width;
                        tempCanvas.height = cropInfo.height;
                        var tempCtx = tempCanvas.getContext("2d");
                        tempCtx.drawImage(fullImg, cropInfo.x, cropInfo.y, cropInfo.width, cropInfo.height, 0, 0, cropInfo.width, cropInfo.height);

                        var croppedImg = new Image();
                        croppedImg.onload = function() {
                            pendingCropImage = croppedImg;

                            var editCanvas = $("edit-canvas");
                            var ctx = editCanvas.getContext("2d");
                            var w = screenSize.width;
                            var h = screenSize.height;
                            var dpr = window.devicePixelRatio || 1;
                            editCanvas.setProperty("width", w * dpr);
                            editCanvas.setProperty("height", h * dpr);
                            editCanvas.style.width = w + "px";
                            editCanvas.style.height = h + "px";
                            ctx.fillStyle = "#ffffff";
                            ctx.fillRect(0, 0, w * dpr, h * dpr);

                            pixelRatio = dpr;
                            imageDataURL = editCanvas.toDataURL("image/png");
                            initEditor();
                        };
                        croppedImg.src = tempCanvas.toDataURL("image/png");
                    };
                    fullImg.src = blobURL;
                }).catch(function(err) { alert(err.message); });
            } else {
                fetch(msg.imageURL).then(function(res) { return res.blob(); }).then(function(blob) {
                    var blobURL = URL.createObjectURL(blob);
                    var img = new Image();
                    img.onload = function() {
                        screenSize.width = Math.floor(img.naturalWidth / window.devicePixelRatio);
                        screenSize.height = Math.floor(img.naturalHeight / window.devicePixelRatio);
                        imageDataURL = blobURL;
                        initEditor();
                    };
                    img.src = blobURL;
                }).catch(function(err) { alert(err.message); });
            }

            commandsExecuted[msg.cmd] = true;
        }
    });

    sendMessage({cmd: "bg:edit:ready"});
});
