import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AnnotationListPanel from './AnnotationListPanel';
import { useAnnotationStore } from '../../stores/annotationStore';

const annotationServiceMock = vi.hoisted(() => ({
  selectAnnotation: vi.fn(),
  removeAnnotation: vi.fn(),
  removeAllAnnotations: vi.fn(),
}));

vi.mock('../../lib/cornerstone/annotationService', () => ({
  annotationService: annotationServiceMock,
}));

function resetStore(): void {
  useAnnotationStore.setState(useAnnotationStore.getInitialState(), true);
}

describe('AnnotationListPanel', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('renders empty state when no annotations exist', () => {
    render(<AnnotationListPanel />);
    expect(screen.getByText('No annotations yet.')).toBeInTheDocument();
    expect(screen.queryByTitle('Remove all annotations')).not.toBeInTheDocument();
  });

  it('supports selecting, deleting, and clearing annotations', async () => {
    const user = userEvent.setup();
    useAnnotationStore.setState({
      ...useAnnotationStore.getState(),
      annotations: [
        {
          annotationUID: 'ann-1',
          toolName: 'Length',
          displayName: 'Length',
          displayText: '12.4 mm',
          label: 'A',
        },
        {
          annotationUID: 'ann-2',
          toolName: 'Angle',
          displayName: 'Angle',
          displayText: '47.0 deg',
          label: '',
        },
      ],
      selectedUID: 'ann-1',
    });

    render(<AnnotationListPanel />);
    expect(screen.getByText('Annotations')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();

    await user.click(screen.getByText('Length: A'));
    expect(annotationServiceMock.selectAnnotation).toHaveBeenCalledWith(null);

    await user.click(screen.getByText('Angle'));
    expect(annotationServiceMock.selectAnnotation).toHaveBeenCalledWith('ann-2');

    await user.click(screen.getAllByTitle('Delete annotation')[0]);
    expect(annotationServiceMock.removeAnnotation).toHaveBeenCalled();

    await user.click(screen.getByTitle('Remove all annotations'));
    expect(annotationServiceMock.removeAllAnnotations).toHaveBeenCalledTimes(1);
  });
});
