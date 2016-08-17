
/* global gl, game, glext */

"use strict";

// Container for all added fonts that allows resetting/rendering/updating all fonts at once.
var fonts =
{
	// Add a new font.
	add: function (name, family, size)
	{
		this[name] = new Font(family, size);
	},

	// Remove all added texts for all fonts.
	resetAll: function()
	{
		for (var fontName in this) {
			if (this[fontName] instanceof Font)
				this[fontName].reset();
		}
	},

	// Render all fonts.
	renderAll: function()
	{
		game.useShaderProg(game.textShaderProg);
		for (var fontName in this) {
			if (this[fontName] instanceof Font)
				this[fontName].render();
		}
	},

	// Notify all fonts about main canvas resize event.
	updateTextureAll: function()
	{
		for (var fontName in this) {
			if (this[fontName] instanceof Font)
				this[fontName].updateTexture();
		}
	}
};

// Font class that renders text using a specific font family and size. Render glyphs using point
// sprites and a texture atlas that is generated from a 2d canvas.
function Font(family, size)
{
	this.canvas = document.createElement("canvas");
	this.canvas.width = 512;
	this.canvas.height = 512;
	this.family = family;
	this.textSize = size;
	this.textColor = new Float32Array([1, 1, 1, 1]);
	this.lineHeight = 0;
	this.vertexData = new Float32Array(this.vertexSize); // Initial capacity 1 vertex.
	this.vertexCount = 0;
	this.buffer = gl.createBuffer();
	this.tex = null;
	this.charData = undefined;
	this.updateTexture();
}

Font.prototype =
{
	vertexSize: 14,
	logicalWidth: 1000,
	maxCodePoint: 127, // Only support Ascii for now.

	// Remove all text instances.
	reset: function()
	{
		this.vertexCount = 0;
	},

	// Add a new text.
	addText: function(text, left, top, wrapWidth)
	{
		if (!wrapWidth)
			wrapWidth = 300;

		var scaleX = game.canvas.width / this.logicalWidth;
		var scaleY = game.canvas.height / (this.logicalWidth / game.aspectRatio);
		left = Math.round(left * scaleX);
		top = Math.round(top * scaleY);
		//width = Math.round(width * scaleX);
		//height = Math.round(height * scaleY);

		var x = left;
		var wrapx = left + wrapWidth;

		for (var i = 0; i < text.length; ++i) {
			var charCode = text.charCodeAt(i);

			//var right = left + width;
			//var bottom = top + height;
			var texLeft = this.charData[4 * charCode + 0];
			var texTop = this.charData[4 * charCode + 1];
			var texWidth = this.charData[4 * charCode + 2];
			var texHeight = this.charData[4 * charCode + 3];
			var width = texWidth * this.canvas.width;
			var height = texHeight * this.canvas.width;
			var cutoffx = width / height;
			var cutoffy = height / height; //TODO find out actual height of the glyphs.

			// Start new line if wrap width reached or encountering a line change character.
			if (x + width >= wrapx && width < wrapWidth || charCode === 10) {
				top += this.lineHeight;
				x = left;
				if (charCode === 10)
					continue;
			}

			this._addVertex(x + 0.5 * height, top + 0.5 * height, width, height,
					texLeft, texTop, texWidth * height / width, texHeight, cutoffx, cutoffy);
			x += width;
		}
	},

	// Render all added texts.
	render: function()
	{
		this._setProjViewMatrix();

		var attribs = game.currentShaderProg.attribLocations;
		var uniforms = game.currentShaderProg.uniformLocations;

		gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
		gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.STREAM_DRAW);

		var bytesPerVertex = this.vertexSize * 4;
		gl.vertexAttribPointer(attribs.position, 2, gl.FLOAT, false, bytesPerVertex, 0);
		glext.vertexAttribDivisorANGLE(attribs.position, 0);
		gl.vertexAttribPointer(attribs.vertexSize, 2, gl.FLOAT, false, bytesPerVertex, 2 * 4);
		glext.vertexAttribDivisorANGLE(attribs.vertexSize, 0);
		gl.vertexAttribPointer(attribs.vertexTextureOffset, 2, gl.FLOAT, false, bytesPerVertex, 4 * 4);
		glext.vertexAttribDivisorANGLE(attribs.vertexTextureOffset, 0);
		gl.vertexAttribPointer(attribs.vertexTextureSize, 2, gl.FLOAT, false, bytesPerVertex, 6 * 4);
		glext.vertexAttribDivisorANGLE(attribs.vertexTextureSize, 0);
		gl.vertexAttribPointer(attribs.vertexTextureCutoff, 2, gl.FLOAT, false, bytesPerVertex, 8 * 4);
		glext.vertexAttribDivisorANGLE(attribs.vertexTextureCutoff, 0);
		gl.vertexAttribPointer(attribs.vertexColor, 4, gl.FLOAT, false, bytesPerVertex, 10 * 4);
		glext.vertexAttribDivisorANGLE(attribs.vertexColor, 0);

		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.tex);

		gl.uniform1i(uniforms.sampler, 0);

		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.enable(gl.BLEND);

		gl.drawArrays(gl.POINTS, 0, this.vertexCount);

		gl.disable(gl.BLEND);
	},

	// Set font color.
	setColor: function(textColor)
	{
		this.textColor = textColor;
	},

	// Notify the font about main canvas being resized, so that text size can be scaled.
	updateTexture: function()
	{
		this._drawCharactersToCanvas();
		this._createTextureFromCanvas();
	},

	// Grow capacity of the vertex array.
	_growVertexData: function()
	{
		var newData = new Float32Array(2 * this.vertexData.length);
		newData.set(this.vertexData);
		this.vertexData = newData;
	},

	// Draw glyphs on a 2d canvas.
	_drawCharactersToCanvas: function()
	{
		// FF has some issues writing the alpha channel in 2d canvas, so we disable it.
		var ctx = this.canvas.getContext("2d", {alpha:false});
		ctx.font = this.textSize * game.canvas.width / this.logicalWidth + "pt " + this.family;
		ctx.fillStyle = "rgba(0, 0, 0, 1)"; // Clear to opaque black.
		ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
		ctx.fillStyle = "rgba(255, 255, 255, 1)"; // Draw glyphs with opaque white.
		ctx.textBaseline = "alphabetic";

		this.charData = new Float32Array(this.maxCodePoint * 4);

		// There's no easy way to get the font height and baseline, so we just approximate.
		this.lineHeight = 2.2 * ctx.measureText("A").width;
		var baseline = Math.round(0.75 * this.lineHeight);

		var y = 0;
		var x = 0;

		for (var c = 0; c < this.maxCodePoint; ++c) {
			var charWidth = ctx.measureText(String.fromCharCode(c)).width;
			if (x + charWidth > this.canvas.width) {
				x = 0;
				y += this.lineHeight + 1; // Leave one pixel between glyphs to avoid artifacts.
			}

			// Store position and size of the glyph within the texture.
			this.charData[4 * c + 0] = x / this.canvas.width;
			this.charData[4 * c + 1] = y / this.canvas.height;
			this.charData[4 * c + 2] = charWidth / this.canvas.width;
			this.charData[4 * c + 3] = this.lineHeight / this.canvas.height;

			ctx.fillText(String.fromCharCode(c), x, y + baseline);

			x += charWidth + 1;
		}
	},

	// Create texture atlas.
	_createTextureFromCanvas: function()
	{
		var format = gl.RGB; // Chrome has performance problems with gl.LUMINANCE?
		if (!this.tex) {
			this.tex = gl.createTexture();
			gl.bindTexture(gl.TEXTURE_2D, this.tex);
			// Canvas uses different coordinate system so we flip y-axis.
			gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
			// The canvas has no alpha channel so this should not do anything,
			// but for some reason without it FF keeps messing up the font texture.
			gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
			gl.texImage2D(gl.TEXTURE_2D, 0, format, format, gl.UNSIGNED_BYTE, this.canvas);
			// We always have 1:1 mapping to screen pixels, so better filters are not needed.
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		} else {
			gl.bindTexture(gl.TEXTURE_2D, this.tex);
			gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
			gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, format, gl.UNSIGNED_BYTE, this.canvas);
		}
	},

	_addVertex: function(x, y, width, height, u, v, texScaleU, texScaleV, texCutoffX, texCutoffY)
	{
		var offset = this.vertexCount * this.vertexSize;
		if (offset + this.vertexSize > this.vertexData.length)
			this._growVertexData();

		this.vertexData[offset] = x;
		this.vertexData[offset + 1] = y;
		this.vertexData[offset + 2] = width;
		this.vertexData[offset + 3] = height;
		this.vertexData[offset + 4] = u;
		this.vertexData[offset + 5] = v;
		this.vertexData[offset + 6] = texScaleU;
		this.vertexData[offset + 7] = texScaleV;
		this.vertexData[offset + 8] = texCutoffX;
		this.vertexData[offset + 9] = texCutoffY;
		this.vertexData[offset + 10] = this.textColor[0];
		this.vertexData[offset + 11] = this.textColor[1];
		this.vertexData[offset + 12] = this.textColor[2];
		this.vertexData[offset + 13] = this.textColor[3];
		++this.vertexCount;
	},

	_setProjViewMatrix: function()
	{
		var projViewMatrix = makeOrthoMatrix(0, game.canvas.width, game.canvas.height, 0);
		var loc = game.currentShaderProg.uniformLocations.projViewMatrix;
		gl.uniformMatrix3fv(loc, false, projViewMatrix);
	}
};
