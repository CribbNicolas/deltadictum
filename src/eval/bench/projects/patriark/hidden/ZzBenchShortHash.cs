using Patriark.Domain.Decisions;
using Patriark.Infrastructure.Persistence;
using Xunit;

namespace Patriark.Tests;

public sealed class ZzBenchShortHash
{
    [Fact]
    public async Task ShortHashIsTheStateHashPrefix()
    {
        var session = await ZzBenchSession.Open(new AlternatingSaveStore(ZzBenchSession.Folder()));
        var state = session.DiagnosticSnapshot();
        var codec = new SnapshotCodec();
        Assert.Equal(codec.StateHash(state)[..12].ToLowerInvariant(), SnapshotCodec.ShortHash(state));
    }
}
