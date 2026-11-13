// @a1
whenBroadcastReceived("Setup", () => {
  setVariableTo(vars.x, "0");
  setVariableTo(vars.y, "0");
  switchCostumeTo("level 1 2");
  createCloneOf("_myself_");
  setVariableTo(vars.x, "360");
  // @c1
  // this makes it scroll
  createCloneOf("_myself_");
  setVariableTo(vars.x, "360");
  switchCostumeTo("level 1 3");
});

// @a2
script(() => {
  switchCostumeTo("level 1 3");
});

// @a3
whenBroadcastReceived("tick", () => {
  // @c2
  // this is the position of the platforms
  call("position %s %s", subtract(vars.x, vars["SCROLL X"]), subtract(vars.y, vars["SCROLL Y"]));
});

// @a4
define("position %s %s", (x, y) => {
    // @c3
    // this makes the level show when its on the screen and hide when its off
    goToXY(x, y);
    ifElse(and(equals(x, xPosition()), equals(y, yPosition())), () => { show(); }, () => { hide(); });
  });
