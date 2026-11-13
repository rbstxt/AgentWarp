// L4 Player: bottom patrol with left/right; space fires Bullet clones.
whenFlagClicked(() => {
  goToXY(0, -120);
  forever(() => {
    ifThen(keyPressed("left arrow"), () => {
      changeX(-5);
    });
    ifThen(keyPressed("right arrow"), () => {
      changeX(5);
    });
  });
});

whenFlagClicked(() => {
  forever(() => {
    ifThen(keyPressed("space"), () => {
      createCloneOf("Bullet");
      wait("0.25");
    });
  });
});
