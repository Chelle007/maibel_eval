type PageHeaderProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Optional extra class for the heading (e.g. mt-2 when there's a back link above). */
  headingClassName?: string;
};

const headingClass = "text-2xl font-semibold text-stone-900";
const descriptionClass = "mt-1 text-sm text-stone-600";

export function PageHeader({ title, description, headingClassName }: PageHeaderProps) {
  return (
    <header>
      <h1 className={headingClassName ? `${headingClass} ${headingClassName}` : headingClass}>
        {title}
      </h1>
      {description != null && <p className={descriptionClass}>{description}</p>}
    </header>
  );
}
