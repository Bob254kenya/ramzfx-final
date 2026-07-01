import { useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { LESSONS } from './course-content';
import './bot-ideas.scss';

const TOTAL_LESSONS = LESSONS.length;

const BotIdeas = observer(() => {
    const [activeIndex, setActiveIndex] = useState(0);
    const [isAnimating, setIsAnimating] = useState(false);
    const [completed, setCompleted] = useState<Set<number>>(new Set([0]));
    const [showToc, setShowToc] = useState(false);

    const lesson = LESSONS[activeIndex];
    const progressPct = useMemo(
        () => Math.round(((activeIndex + 1) / TOTAL_LESSONS) * 100),
        [activeIndex]
    );

    useEffect(() => {
        setCompleted(prev => {
            if (prev.has(activeIndex)) return prev;
            const next = new Set(prev);
            next.add(activeIndex);
            return next;
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [activeIndex]);

    const goTo = (index: number) => {
        if (index < 0 || index >= TOTAL_LESSONS || index === activeIndex) return;
        setIsAnimating(true);
        setTimeout(() => {
            setActiveIndex(index);
            setIsAnimating(false);
            setShowToc(false);
        }, 220);
    };

    return (
        <div className='bot-ideas-page'>
            <div className='bot-ideas-page__inner'>
                <header className='bot-ideas-page__header'>
                    <span className='course-badge'>🎓 Deriv Academy</span>
                    <h1 className='bot-ideas-page__title'>Deriv Trading Mastery Course</h1>
                    <p className='course-subtitle'>
                        25 in-depth lessons covering everything you need to know about trading on Deriv —
                        synthetic indices, forex, contract types, DBot automation, technical analysis,
                        risk management and trading psychology.
                    </p>

                    <div className='course-progress'>
                        <div className='course-progress__bar'>
                            <div
                                className='course-progress__fill'
                                style={{ width: `${progressPct}%` }}
                            />
                        </div>
                        <span className='course-progress__label'>
                            Lesson {activeIndex + 1} of {TOTAL_LESSONS} · {progressPct}% explored
                        </span>
                    </div>

                    <button
                        type='button'
                        className='course-toc-toggle'
                        onClick={() => setShowToc(prev => !prev)}
                    >
                        {showToc ? '✕ Close lesson list' : '📚 Browse all 25 lessons'}
                    </button>
                </header>

                {showToc && (
                    <nav className='course-toc'>
                        {LESSONS.map((l, idx) => (
                            <button
                                type='button'
                                key={l.id}
                                className={[
                                    'course-toc__item',
                                    idx === activeIndex ? 'course-toc__item--active' : '',
                                    completed.has(idx) ? 'course-toc__item--done' : '',
                                ].join(' ').trim()}
                                onClick={() => goTo(idx)}
                            >
                                <span className='course-toc__num'>{idx + 1}</span>
                                <span className='course-toc__text'>
                                    <span className='course-toc__title'>{l.title}</span>
                                    <span className='course-toc__tag'>{l.tag}</span>
                                </span>
                                {completed.has(idx) && <span className='course-toc__check'>✓</span>}
                            </button>
                        ))}
                    </nav>
                )}

                <section className='course-layout'>
                    <aside className='course-rail'>
                        {LESSONS.map((l, idx) => (
                            <button
                                type='button'
                                key={l.id}
                                title={l.title}
                                className={[
                                    'course-rail__dot',
                                    idx === activeIndex ? 'course-rail__dot--active' : '',
                                    completed.has(idx) ? 'course-rail__dot--done' : '',
                                ].join(' ').trim()}
                                onClick={() => goTo(idx)}
                            >
                                {idx + 1}
                            </button>
                        ))}
                    </aside>

                    <article className={`course-card ${isAnimating ? 'course-card--leaving' : 'course-card--entering'}`}>
                        <div className='course-card__eyebrow'>
                            <span className='course-card__tag'>{lesson.tag}</span>
                            <span className='course-card__count'>Lesson {activeIndex + 1} / {TOTAL_LESSONS}</span>
                        </div>

                        <h2 className='course-card__title'>{lesson.title}</h2>

                        {lesson.intro && <p className='course-card__intro'>{lesson.intro}</p>}

                        <div className='course-card__body'>
                            {lesson.sections.map((sec, i) => (
                                <div className='course-block' key={i} style={{ animationDelay: `${i * 70}ms` }}>
                                    {sec.heading && <h3 className='course-block__heading'>{sec.heading}</h3>}
                                    {sec.paragraphs?.map((p, pi) => (
                                        <p className='course-block__paragraph' key={pi}>{p}</p>
                                    ))}
                                    {sec.bullets && (
                                        <ul className='course-block__list'>
                                            {sec.bullets.map((b, bi) => (
                                                <li key={bi}>{b}</li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            ))}
                        </div>

                        {lesson.keyTakeaway && (
                            <div className='course-callout'>
                                <span className='course-callout__icon'>💡</span>
                                <div>
                                    <p className='course-callout__label'>Key takeaway</p>
                                    <p className='course-callout__text'>{lesson.keyTakeaway}</p>
                                </div>
                            </div>
                        )}

                        <div className='course-card__nav'>
                            <button
                                type='button'
                                className='course-nav-btn course-nav-btn--prev'
                                onClick={() => goTo(activeIndex - 1)}
                                disabled={activeIndex === 0}
                            >
                                ← Previous
                            </button>
                            <span className='course-nav-page'>{activeIndex + 1} / {TOTAL_LESSONS}</span>
                            <button
                                type='button'
                                className='course-nav-btn course-nav-btn--next'
                                onClick={() => goTo(activeIndex + 1)}
                                disabled={activeIndex === TOTAL_LESSONS - 1}
                            >
                                Next →
                            </button>
                        </div>
                    </article>
                </section>
            </div>
        </div>
    );
});

export default BotIdeas;
