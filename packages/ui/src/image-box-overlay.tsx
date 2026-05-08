import type { Detection } from "@sightline/core";

export function ImageBoxOverlay(props: {
  imageUrl: string;
  imageAlt: string;
  imageWidth: number;
  imageHeight: number;
  detections: Detection[];
}) {
  return (
    <div className="relative aspect-[256/180] overflow-hidden bg-stone-300">
      <img className="absolute inset-0 h-full w-full object-cover" src={props.imageUrl} alt={props.imageAlt} />
      <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${props.imageWidth} ${props.imageHeight}`} aria-hidden="true">
        {props.detections.map((box) => (
          <rect
            key={box.id}
            x={box.x1}
            y={box.y1}
            width={box.x2 - box.x1}
            height={box.y2 - box.y1}
            className="fill-teal-500/20 stroke-cyan-300"
            strokeWidth={4}
          />
        ))}
      </svg>
    </div>
  );
}
