// L5 Platform: one clone per platforms item. The original stays hidden; each
// clone claims the next list index (creations are separated by waits, so the
// claim is race-free) and then positions itself in screen space every frame,
// which is what makes the camera scroll visible.
whenFlagClicked(() => {
  hide();
});

whenBroadcastReceived("clear", () => {
  deleteThisClone();
});

whenBroadcastReceived("build", () => {
  setVariableTo(vars.pi, 0);
  repeat(lengthOfList(lists.platforms), () => {
    createCloneOf("_myself_");
    wait("0.05");
  });
});

whenStartAsClone(() => {
  changeVariableBy(vars.pi, 1);
  setVariableTo(vars.rect, itemOfList(vars.pi, lists.platforms));
  setVariableTo(vars.pw, mod(vars.rect, 1000));
  setVariableTo(vars.pt, mathOp("floor", divide(vars.rect, 1000)));
  setVariableTo(vars.ppy, subtract(mod(vars.pt, 1000), 200));
  setVariableTo(vars.pcx, subtract(mathOp("floor", divide(vars.pt, 1000)), 250));
  setSizeTo(divide(vars.pw, 100));
  show();
  forever(() => {
    setX(subtract(vars.pcx, vars.camX));
    setY(vars.ppy);
  });
});
