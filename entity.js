
/* global game, models, MissileLauncher, RocketLauncher, DualBlaster, Laser, Projectile, modules, colors */

"use strict";


// Base class for all game entities.
var Entity = extend(Object,
{
	ctor: function() // p, hp
	{
		this.id = this.staticVars.idCounter++;
	},

	faction: 0, // Neutral faction.
	staticVars: {
		idCounter: 0
	},

	canCollide: null,

	step: function(timestamp, dt)
	{
	},

	collide: function(timestamp, dt, other)
	{
	},

	takeDamage: function(timestamp, damage)
	{
	},

	render: function()
	{
	},

	calculateDrag: function(dt)
	{
		var vlen = this.v.len();
		var dragAccel = Math.min(this.dragCoefficient * vlen * vlen * dt, vlen);
		if (vlen > 1e-10)
			this.v.sub_(this.v.setlen(dragAccel));
	},

	deaccelerate: function(dt, deaccel)
	{
		var vlen = this.v.len();
		if (vlen > deaccel * dt)
			this.v.sub_(this.v.setlen(deaccel * dt));
		else
			this.v.setlen_(1e-9);
	}
});


// Base class for ships.
var Ship = extend(Entity,
{
	ctor: function() // p, hp, v/dir
	{
		Entity.call(this);
		if (!this.v) {
			this.v = this.dir.mul_(this.calculateMaxSpeed());
			delete this.dir;
		}
		this.a = new V(0, 0);
		this.modules = [];
	},

	lootProbabilityMultiplier: 0,
	dragCoefficient: 0,
	debrisSpeed: 50,
	debrisExpireTime: 3,
	collisionDamage: 0,

	step: function(timestamp, dt)
	{
		for (var i = 0; i < this.modules.length; ++i) {
			if (this.modules[i])
				this.modules[i].step(timestamp, dt);
		}

		this.v.add_(this.a.mul(dt));
		this.p.add_(this.v.mul(dt));
		this.calculateDrag(dt);
	},

	canCollide: function(other)
	{
		return !(other instanceof Ship && other.faction === this.faction);
	},

	collide: function(timestamp, dt, other)
	{
		other.takeDamage(timestamp, this.collisionDamage);
	},

	takeDamage: function(timestamp, damage)
	{
		this.hp -= damage;
		if (this.hp <= 0) {
			this.die(timestamp);
			this.spreadDebris(timestamp);
		}
	},

	spreadDebris: function(timestamp)
	{
		var debrisCount = 3 + this.m / 5e3;
		var color = new Float32Array([
			0.3 + 0.5 * this.color[0],
			0.3 + 0.5 * this.color[1],
			0.3 + 0.5 * this.color[2],
			1
		]);
		for (var i = 0; i < debrisCount; ++i) {
			var angle = Math.random() * 2 * Math.PI;
			var v = new V(Math.cos(angle), Math.sin(angle));
			v.mul_(this.debrisSpeed * (0.1 + 0.9 * Math.random()));
			v.add_(this.v);
			var expire = timestamp + (0.2 + Math.random()) * this.debrisExpireTime;
			game.addEntity(init(Debris, { p: this.p.clone(), v: v,
					expire: expire, color: this.color.slice(0)}));
		}
	},

	relativePos: function(x, y)
	{
		var forward = this.v.setlenSafe(1);
		var right = forward.rot90right();
		return forward.mul_(y).add_(right.mul_(x)).add_(this.p);
	},

	die: function(timestamp)
	{
		for (var i = 0; i < this.modules.length; ++i) {
			if (this.modules[i])
				this.modules[i].unequip();
		}
		this.modules = [];
		this._dropLoot(timestamp);
	},

	equipModule: function(slot, module)
	{
		var oldModule = null;
		if (this.modules[slot]) {
			oldModule = this.modules[slot];
			oldModule.unequip();
			oldModule.ship = null;
		}
		this.modules[slot] = module;
		this.modules[slot].ship = this;
		this.modules[slot].equip();
		return oldModule;
	},

	render: function()
	{
		for (var i = 0; i < this.modules.length; ++i) {
			if (this.modules[i])
				this.modules[i].render();
		}
	},

	calculateMaxSpeed: function()
	{
		return Math.sqrt(this.acceleration / this.dragCoefficient);
	},

	_dropLoot: function(timestamp)
	{
		if (this.faction === 2) {
			var rnd = Math.random() / this.lootProbabilityMultiplier;
			var lootClass = LootModule;
			var moduleClass = undefined;
			if ((rnd -= 0.06) < 0) {
				lootClass = RepairKit
			} else if ((rnd -= 0.01) < 0) {
				moduleClass = RocketLauncher;
			} else if ((rnd -= 0.01) < 0) {
				moduleClass = MissileLauncher;
			} else if ((rnd -= 0.01) < 0) {
				moduleClass = Laser;
			} else if ((rnd -= 0.01) < 0) {
				moduleClass = DualBlaster;
			} else if ((rnd -= 0.01) < 0) {
				moduleClass = modules.Shield;
			} else {
				lootClass = null;
			}

			if (lootClass) {
				game.addEntity(init(lootClass, { p: this.p.clone(), expire: timestamp + 10,
						moduleClass: moduleClass}));
			}
		}
	}
});


// Expanding circular explosion that deals damage to ships and pushes them back.
var Explosion = extend(Entity,
{
	ctor: function() // p, v, maxRadius, speed, damage, force
	{
		Entity.call(this);
		if (!this.damage)
			this.startRadius = 0;
		this.radius = this.startRadius; // Ensure that explosive projectiles deal damage on collision.
		this.phase = 0;
		this.c = this.speed / this.maxRadius;
		this.hitEntities = {}; // Keep track of entities hit by explosion
		if (this.damage)
			this._addSecondaryExplosions(3);
	},

	force: 0,
	damage: 0,
	hp: 1,
	dragCoefficient: 0.05,
	startRadius: 2,
	fadeTime: 0.3,

	step: function(timestamp, dt)
	{
		this.calculateDrag(dt);
		this.p.add_(this.v.mul(dt));

		this.phase += this.c * dt;

		if (this.phase < 1) {
			// Radius function is adjusted so that expanding stops when phase = 1.
			this.radius = this.maxRadius * Math.pow(2 * this.phase - this.phase * this.phase, 0.8) + this.startRadius;
		} else if (this.phase > 1 + this.fadeTime) {
			this.hp = 0;
		}
	},

	canCollide: function(other)
	{
		return this.damage > 0 && other.m && !(other instanceof Projectile)
				&& other.faction !== this.faction && this.phase < 1;
	},

	collide: function(timestamp, dt, other)
	{
		other.v.add_(other.p.sub(this.p).setlen_(dt * this.force / other.m));
		if (!this.hitEntities[other.id]) {
			other.takeDamage(timestamp, this.damage);
			this.hitEntities[other.id] = true;
		}
	},

	render: function()
	{
		// Smoothstep.
		function smooth(t, t1, t2, v1, v2) {
			if (t < t1)
				return v1;
			else if (t < t2) {
				var x = (t - t1) / (t2 - t1);
				return v1 + (3 * x * x - 2 * x * x * x) * (v2 - v1);
			} else
				return v2;
		}

		// Render three sprites of different sizes.
		var n = 3;
		var alpha = smooth(this.phase, 0.9, 1 + this.fadeTime, 0.9, 0);
		for (var i = 0; i < 3; ++i) {
			var r = (n - i) / n;

			// Biggest sprite is red, medium is green and smallest is blue. This will
			// make the explosion center white, middle parts yellow and edges red.
			if (i === 0)
				var color = [0.7 - this.phase * 0.2, 0.5 - this.phase * 0.3, 0.2 - this.phase * 0.2, alpha];
			else if (i === 1)
				var color = [0.5 - this.phase * 0.1, 0.8 - this.phase * 0.4, 0.2 - this.phase * 0.2, alpha];
			else
				var color = [0.3 - this.phase * 0.1, 0.5 - this.phase * 0.3, 0.8 - this.phase * 0.8, alpha];

			if (i === 0) {
				// If this explosion deals damage then render the outermost ring with hard edges.
				if (this.damage) {
					models.solidCircle16.render(color, this.p, new V(0, 1), r * this.radius);
					models.circle16.render(new Float32Array([0.4, 0.2, 0, alpha]), this.p, new V(0, 1), this.radius);
				} else
					models.point.render(color, this.p, new V(0, 1), r * this.radius * 1.9);
			} else {
				models.point.render(color, this.p, new V(0, 1), r * this.radius * 1.5);
			}
		}
	},

	// Adds some cosmetic explosions that deal no damage. (Looks much better!)
	_addSecondaryExplosions: function(n)
	{
		for (var i = 0; i < n; ++i) {
			game.addEntity(init(Explosion, {
				p: this.p.add(new V((Math.random() - 0.5) * 0.3 * this.maxRadius,
					(Math.random() - 0.5) * 0.3 * this.maxRadius)),
				v: this.v.add(new V((Math.random() - 0.5) * 0.5 * this.speed,
					(Math.random() - 0.5) * 0.5 * this.speed)),
				maxRadius: (1 - (i + 1) * (0.5 / n)) * this.maxRadius,
				speed: (1 - 0.5 / n) * this.speed,
				faction: this.faction,
			}));
		}
	},
});


// Shield that blocks incoming enemy projectiles. The shield takes damage and regenerates hitpoints over time.
// If it reaches 0 hp, it doesn't die but becomes inactive. It can activate again by regenerating.
var ShieldEntity = extend(Entity,
{
	ctor: function() // p, radius
	{
		Entity.call(this);
		// Make the shield hollow so that enemies inside the shield range can still shoot.
		this.innerRadius = Math.max(this.radius - 5, 0);
		this.hp = this.maxHp;
		this.v = new V(0,0);
		this._active = true;
		this._lastDamageTime = 0;
	},

	maxHp: 1e9, //TODO Infinity?
	m: 1e9,
	regen: 0,
	regenDelay: 0,
	inactiveRegenDelay: 0,
	maxBlockRadius: 3,
	collisionDamage: 10,

	step: function(timestamp, dt)
	{
		var delay = this._active ? this.regenDelay : this.inactiveRegenDelay;
		if (timestamp - this._lastDamageTime >= delay) {
			this.hp = Math.min(this.maxHp, this.hp + this.regen * dt);
			this._active = true;
		}
	},

	canCollide: function(other)
	{
		// Block small incoming objects.
		return this._active && other.radius <= this.maxBlockRadius && this.p.sub(other.p).dot(other.v) >= 0;
	},

	collide: function(timestamp, dt, other)
	{
		other.takeDamage(timestamp, this.collisionDamage);
	},

	takeDamage: function(timestamp, damage)
	{
		// Prevent the shield from taking lethal damage. Instead we just deactivate it.
		this._lastDamageTime = timestamp;
		if (this.hp - damage < 1e-3) {
			arguments[1] = this.hp - 1e-3;
			this._active = false;
		}
		Ship.prototype.takeDamage.apply(this, arguments);
	},

	render: function()
	{
		if (this._active) {
			var alpha = 0.5 + 0.5 * this.hp / this.maxHp;
			var color = colors.shield.slice(0);
			color[3] *= alpha;
			models.solidCircle16.render(color, this.p, new V(0, 1), this.radius);
			models.circle16.render([0.2, 0.2, 0.4, 1.0 * alpha], this.p, new V(0, 1), this.radius);
		}
	},
});
