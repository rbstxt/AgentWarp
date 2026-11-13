// @a1
whenFlagClicked(() => {
  hide();
  forever(() => { createCloneOf("_myself_"); });
});

// @a2
whenStartAsClone(() => {
  show();
  goTo("_mouse_");
  repeat("10", () => { changeSizeBy("5"); });
  deleteThisClone();
});
