import { useLayoutEffect, useRef } from 'react';
import { MapController, type ControllerEvents, type ControllerProps } from '../canvas/MapController';

interface Props extends ControllerProps {
  events: ControllerEvents;
  controller: React.RefObject<MapController | null>;
}

/** The hex map. Drawing, camera and input live in MapController; this only mounts it and feeds it props. */
export function MapCanvas({ events, controller, ...props }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(events);
  latest.current = events;

  useLayoutEffect(() => {
    const wrap = canvas.current!.parentElement!;
    const c = new MapController(canvas.current!, wrap, {
      arrive: id => latest.current.arrive(id),
      openCurrent: () => latest.current.openCurrent(),
      hover: h => latest.current.hover(h),
    });
    controller.current = c;
    c.setProps(props);
    c.start();
    return () => { c.destroy(); controller.current = null; };
  }, []);

  /* after every commit, so the controller sees the popup as laid out now */
  useLayoutEffect(() => { controller.current?.setProps(props); });

  return (
    <canvas ref={canvas} className="map-canvas" tabIndex={0}
      aria-label="Hex map of a corpus of papers. Coloured tiles are papers you have read, grey tiles are revealed but unread, blank tiles are uncharted. Papers can also be reached from the Log." />
  );
}
