// L4 Player. Arrow keys move; a loop fires a Bullet clone every 0.5 s.
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
    createCloneOf("Bullet");
    wait("0.5");
  });
});
