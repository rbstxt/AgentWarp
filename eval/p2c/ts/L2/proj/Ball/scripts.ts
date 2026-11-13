// L2 Ball: moves diagonally and bounces off edges forever.
whenFlagClicked(() => {
  goToXY(0, 0);
  pointInDirection(45);
  forever(() => {
    moveSteps(5);
    ifOnEdgeBounce();
  });
});
