// L5 Player: platformer hero. Screen x stays 0 while the camera follows the
// world position pwx; screen y equals world y (no vertical scroll).
// Custom block: move by (dx, dy), then resolve landing against the platforms.
define("collide %n %n", { warp: true }, (dx = 0, dy = 0) => {
  changeVariableBy(vars.pwx, dx);
  changeY(dy);
  setVariableTo(vars.onGround, 0);
  setVariableTo(vars.idx, 0);
  repeat(lengthOfList(lists.platforms), () => {
    changeVariableBy(vars.idx, 1);
    setVariableTo(vars.rect, itemOfList(vars.idx, lists.platforms));
    setVariableTo(vars.pw, mod(vars.rect, 1000));
    setVariableTo(vars.pt, mathOp("floor", divide(vars.rect, 1000)));
    setVariableTo(vars.ppy, subtract(mod(vars.pt, 1000), 200));
    setVariableTo(vars.pcx, subtract(mathOp("floor", divide(vars.pt, 1000)), 250));
    // Land when falling and feet cross a platform top inside its x-range.
    ifThen(and(lessThan(vars.vy, 0), and(greaterThan(yPosition(), subtract(vars.ppy, 14)), lessThan(yPosition(), add(vars.ppy, 4)))), () => {
      ifThen(and(greaterThan(vars.pwx, subtract(vars.pcx, divide(vars.pw, 2))), lessThan(vars.pwx, add(vars.pcx, divide(vars.pw, 2)))), () => {
        setY(vars.ppy);
        setVariableTo(vars.vy, 0);
        setVariableTo(vars.onGround, 1);
      });
    });
  });
});

// Level spawn points (screen x is always 0 because the camera follows pwx).
whenBroadcastReceived("level1", () => {
  goToXY(0, 150);
  setVariableTo(vars.pwx, 0);
  setVariableTo(vars.vy, 0);
});

whenBroadcastReceived("level2", () => {
  goToXY(0, 150);
  setVariableTo(vars.pwx, -320);
  setVariableTo(vars.vy, 0);
});

// Main loop: gravity, horizontal input, ground-only jump, camera follow.
whenFlagClicked(() => {
  forever(() => {
    changeVariableBy(vars.vy, -1);
    ifThen(lessThan(vars.vy, -12), () => {
      setVariableTo(vars.vy, -12);
    });
    setVariableTo(vars.mdx, 0);
    ifThen(keyPressed("left arrow"), () => {
      setVariableTo(vars.mdx, -4);
    });
    ifThen(keyPressed("right arrow"), () => {
      setVariableTo(vars.mdx, 4);
    });
    ifThen(and(keyPressed("space"), equals(vars.onGround, 1)), () => {
      setVariableTo(vars.vy, 15);
    });
    call("collide %n %n", vars.mdx, vars.vy);
    setVariableTo(vars.camX, vars.pwx);
  });
});

// Goal touch switches levels (level set to 0 first so this fires only once).
whenFlagClicked(() => {
  forever(() => {
    ifThen(and(touching("Goal"), equals(vars.level, 1)), () => {
      setVariableTo(vars.level, 0);
      broadcast("level2");
    });
    ifThen(and(touching("Goal"), equals(vars.level, 2)), () => {
      setVariableTo(vars.level, 0);
      broadcast("level1");
    });
  });
});
