import Image from "next/image";

export type MascotPose = "welcome" | "reading" | "searching" | "problem";
export type MascotSize = "sm" | "md" | "lg";

const sizeMap: Record<MascotSize, number> = {
  sm: 72,
  md: 120,
  lg: 156,
};

export function Otto({
  pose = "welcome",
  animate = false,
  size = "md",
  className = "",
}: {
  pose?: MascotPose;
  animate?: boolean;
  size?: MascotSize;
  className?: string;
}) {
  const px = sizeMap[size];
  return (
    <span
      className={`mascot-frame mascot-frame--${size}${animate ? " otto-float" : ""}${className ? ` ${className}` : ""}`}
    >
      <Image
        className="otto"
        src={`/mascot/scholar-${pose}.jpg`}
        alt=""
        width={px}
        height={px}
        priority={pose === "welcome"}
      />
    </span>
  );
}
