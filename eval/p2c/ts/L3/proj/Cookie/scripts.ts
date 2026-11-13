// L3 Cookie clicker: +1 score, pop sound, pressed costume flash, win at 10.
whenThisSpriteClicked(() => {
  changeVariableBy(vars.score, 1);
  startSound("pop");
  switchCostumeTo("pressed");
  wait("0.1");
  switchCostumeTo("normal");
  ifThen(equals(vars.score, 10), () => {
    broadcast("win");
  });
});
